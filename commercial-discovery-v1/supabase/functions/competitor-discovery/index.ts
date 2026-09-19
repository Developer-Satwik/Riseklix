import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'
import { firecrawlSearch, type FirecrawlDocument } from '../_shared/firecrawl.ts'
import { openAIPromptCacheKey, recordOpenAIUsage } from '../_shared/openai-usage.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

type RequestBody = {
  project_id?: string
  intent_id?: string
  regenerate?: boolean
}

type EvidenceItem = {
  url: string
  title: string
  claim: string
}

type Candidate = {
  company_name: string
  domain: string
  relationship: 'direct' | 'near_direct' | 'substitute' | 'benchmark'
  discovery_layer: 0 | 1 | 2 | 3 | 4 | 5
  hard_constraints_satisfied: boolean
  matched_constraints: string[]
  relaxed_constraints: string[]
  rationale: string
  evidence: EvidenceItem[]
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'candidates'],
  properties: {
    summary: { type: 'string' },
    candidates: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'company_name', 'domain', 'relationship', 'discovery_layer',
          'hard_constraints_satisfied', 'matched_constraints', 'relaxed_constraints',
          'rationale', 'evidence',
        ],
        properties: {
          company_name: { type: 'string' },
          domain: { type: 'string' },
          relationship: { type: 'string', enum: ['direct', 'near_direct', 'substitute', 'benchmark'] },
          discovery_layer: { type: 'integer', minimum: 0, maximum: 5 },
          hard_constraints_satisfied: { type: 'boolean' },
          matched_constraints: { type: 'array', items: { type: 'string' } },
          relaxed_constraints: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
          evidence: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['url', 'title', 'claim'],
              properties: {
                url: { type: 'string' },
                title: { type: 'string' },
                claim: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const

async function continueAutopilot(req: Request, projectId: string) {
  const authHeader = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authHeader || !supabaseUrl) return

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: authHeader,
  }
  if (anonKey) headers.apikey = anonKey

  try {
    await fetch(supabaseUrl + '/functions/v1/auto-analysis-runner', {
      method: 'POST',
      headers,
      body: JSON.stringify({ project_id: projectId }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    // The durable project state remains available for a later retry.
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    url.search = ''
    let normalized = url.toString()
    if (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized.toLowerCase()
  } catch {
    return null
  }
}

function normalizeDomain(value: string) {
  try {
    const raw = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  }
}

function outputText(response: unknown) {
  const value = record(response)
  if (typeof value.output_text === 'string') return value.output_text
  const output = Array.isArray(value.output) ? value.output : []
  for (const item of output) {
    const message = record(item)
    const content = Array.isArray(message.content) ? message.content : []
    for (const part of content) {
      const block = record(part)
      if (typeof block.text === 'string') return block.text
    }
  }
  return ''
}

function collectSearchSources(response: unknown) {
  const value = record(response)
  const output = Array.isArray(value.output) ? value.output : []
  const sources: Array<{ url: string; title: string }> = []

  for (const item of output) {
    const block = record(item)
    if (block.type !== 'web_search_call') continue
    const action = record(block.action)
    const actionSources = Array.isArray(action.sources) ? action.sources : []
    for (const source of actionSources) {
      const candidate = record(source)
      if (typeof candidate.url === 'string') {
        sources.push({
          url: candidate.url,
          title: typeof candidate.title === 'string' ? candidate.title : candidate.url,
        })
      }
    }
  }

  return sources
}

function marketCountry(market: string) {
  const values: Record<string, string> = {
    India: 'IN',
    'United States': 'US',
    'United Kingdom': 'GB',
    UAE: 'AE',
    Singapore: 'SG',
    Australia: 'AU',
  }
  return values[market]
}

function uniqueFirecrawlDocs(groups: FirecrawlDocument[][]) {
  const byUrl = new Map<string, FirecrawlDocument>()
  for (const group of groups) {
    for (const item of group) {
      const key = normalizeUrl(item.url)
      if (!key || byUrl.has(key)) continue
      byUrl.set(key, item)
    }
  }
  return [...byUrl.values()]
}

function effectiveStrength(domain: string, evidence: EvidenceItem[]) {
  const candidateDomain = normalizeDomain(domain)
  const official = evidence.some((item) => normalizeDomain(item.url) === candidateDomain)
  const thirdParty = evidence.some((item) => normalizeDomain(item.url) !== candidateDomain)
  if (evidence.length >= 2 && official && thirdParty) return 'strong' as const
  if (evidence.length >= 2 || official) return 'moderate' as const
  return 'weak' as const
}

function dedupe(candidates: Candidate[]) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = normalizeDomain(candidate.domain) || candidate.company_name.toLowerCase().trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const projectId = body.project_id?.trim()
    const intentId = body.intent_id?.trim()
    if (!projectId || !intentId) return json({ error: 'project_id and intent_id are required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      return json({
        error: 'reasoning_provider_not_configured',
        message: 'OPENAI_API_KEY is not configured for competitor discovery.',
      }, 503)
    }

    const [{ data: project, error: projectError }, { data: intent, error: intentError }] = await Promise.all([
      ctx.supabase
        .from('projects')
        .select('id,workspace_id,name,domain,market')
        .eq('id', projectId)
        .single(),
      ctx.supabase
        .from('buyer_intents')
        .select('id,intent_key,version,status,title,buyer,job_to_be_done,constraints,required_capabilities,geography,commercial_model,purchase_stage,priority')
        .eq('id', intentId)
        .eq('project_id', projectId)
        .single(),
    ])

    if (projectError || intentError || !project || !intent) return json({ error: 'Project or Buyer Intent not found' }, 404)
    if (intent.status !== 'approved') return json({ error: 'intent_not_approved', message: 'Approve the Buyer Intent before competitor discovery.' }, 409)

    const { data: profile } = await ctx.supabase
      .from('company_profile_versions')
      .select('company_name,industry,business_model,products,services,geographies,uncertainty')
      .eq('project_id', project.id)
      .eq('is_current', true)
      .single()

    const model = Deno.env.get('RISEKLIX_COMPETITOR_MODEL') || 'gpt-5.6-terra'
    const escalationModel = Deno.env.get('RISEKLIX_COMPETITOR_ESCALATION_MODEL') || 'gpt-5.6-sol'
    const idempotencyKey = `competitor-discovery:${intent.id}:v${intent.version}:${model}:escalate-${escalationModel}`

    if (!body.regenerate) {
      const existing = await ctx.supabase
        .from('research_jobs')
        .select('id,status,progress,stage,output,error,created_at')
        .eq('project_id', project.id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()

      if (existing.data?.status === 'succeeded') {
        return json({ job: existing.data, reused: true, generated: record(existing.data.output).generated ?? 0 })
      }

      if (existing.data?.status === 'running') {
        const createdAt = new Date(existing.data.created_at).getTime()
        const ageMs = Number.isFinite(createdAt) ? Date.now() - createdAt : 0
        if (ageMs < 120_000) {
          return json({
            job: existing.data,
            pending: true,
            message: 'Competitor research is already running for this Buyer Situation.',
          }, 202)
        }
      }

      if (existing.data) {
        await ctx.supabase.from('research_jobs').update({
          status: existing.data.status === 'running' ? 'failed' : existing.data.status,
          stage: existing.data.status === 'running' ? 'competitor_discovery_interrupted' : existing.data.stage,
          error: existing.data.status === 'running'
            ? { message: 'Previous synchronous competitor research did not finish before the request window closed.' }
            : existing.data.error,
          completed_at: existing.data.status === 'running' ? new Date().toISOString() : null,
          idempotency_key: idempotencyKey + ':previous:' + existing.data.id,
        }).eq('id', existing.data.id)
      }
    }

    const budget = await ctx.supabase.rpc('consume_ai_budget', {
      p_project_id: project.id,
      p_kind: 'reasoning',
      p_units: 1,
    })
    if (budget.error) return json({ error: 'ai_budget_check_failed', message: budget.error.message }, 500)
    const budgetState = record(budget.data)
    if (budgetState.allowed !== true) {
      return json({
        error: 'ai_budget_exceeded',
        message: budgetState.blocked_scope === 'minute' ? 'Riseklix hit the workspace per-minute AI safety limit. The request was stopped before another paid model call.' : 'Riseklix hit the workspace daily AI safety limit. The request was stopped before another paid model call.',
        usage: budgetState,
      }, 429)
    }

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase
      .from('research_jobs')
      .insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        created_by: userId,
        job_type: 'competitor_discovery',
        status: 'running',
        progress: 10,
        stage: 'preparing_intent_constraints',
        idempotency_key: body.regenerate ? `${idempotencyKey}:${crypto.randomUUID()}` : idempotencyKey,
        input: { intent_id: intent.id, intent_key: intent.intent_key, intent_version: intent.version, model },
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start competitor discovery' }, 400)

    const discoveryTask = (async () => {
      try {
        await ctx.supabase.from('research_jobs').update({ progress: 25, stage: 'researching_competitor_universe' }).eq('id', job.id)

      const openai = new OpenAI({ apiKey })
      const input = {
        target_company: {
          name: profile?.company_name ?? project.name,
          domain: project.domain,
          market: project.market,
          industry: profile?.industry ?? null,
          business_model: profile?.business_model ?? null,
          products: profile?.products ?? [],
          services: profile?.services ?? [],
          geographies: profile?.geographies ?? [],
          uncertainty: profile?.uncertainty ?? [],
        },
        approved_buyer_intent: intent,
      }

      const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
      let firecrawlSources: FirecrawlDocument[] = []

      if (firecrawlKey) {
        const hardConstraintText = JSON.stringify(intent.constraints)
        const capabilityText = JSON.stringify(intent.required_capabilities)
        const queries = [
          intent.title + ' ' + intent.job_to_be_done + ' ' + project.market,
          intent.commercial_model + ' ' + capabilityText.slice(0, 500) + ' ' + hardConstraintText.slice(0, 500) + ' ' + project.market,
        ]

        const searched = await Promise.all(
          queries.map((query) => firecrawlSearch(firecrawlKey, query, {
            limit: 6,
            location: marketCountry(project.market),
            scrape: true,
          }))
        )

        firecrawlSources = uniqueFirecrawlDocs(searched).slice(0, 12)
      }

      const retrievalPackets = firecrawlSources.map((source) => ({
        url: source.url,
        title: source.title,
        description: source.description,
        text_sample: source.markdown.slice(0, 7000),
      }))

      const instructions = `You are the intent-specific Competitor Discovery engine for Riseklix Commercial Discovery.

Discover and classify companies for ONE approved Buyer Intent using only current retrieved evidence.

The evaluated company's overall category is not enough. A competitor is relevant only to this specific buying situation.

LADDER
L0 DIRECT: satisfies every hard constraint and the important constraints with evidence; same buying job and commercial model.
L1 NEAR-DIRECT: satisfies every hard constraint and the core buying job; only contextual constraints may be relaxed.
L2 CONTROLLED RELAXATION: every hard constraint remains satisfied; one or more important constraints may be relaxed. State each relaxation explicitly.
L3 BROADENED FIT: every hard constraint remains satisfied; broader geography, operating model or delivery approach may be considered only where that item is not itself a hard constraint.
L4 SUBSTITUTE: solves the buyer's underlying job through a meaningfully different category or approach while still respecting the hard constraints.
L5 BENCHMARK: useful adjacent benchmark or category leader, clearly not a direct competitor for this exact buying situation.

RULES
1. NEVER relax a hard constraint. If a company fails one, exclude it entirely.
2. Do not fabricate capabilities, locations, commercial models, certifications, fleet, installation, rental, service coverage or other operating facts.
3. Every included company needs at least one exact evidence URL from the supplied retrieval packets or search sources. Prefer first-party evidence and independent corroboration when available.
4. Exclude the evaluated company itself and aliases of its own domain.
5. Do not intentionally diversify brands. Include the companies that actually fit the intent.
6. A manufacturer that cannot satisfy a rental intent is not a direct competitor merely because it makes the same equipment. A local rental operator that cannot meet a hard multi-city requirement should be excluded if multi-city is hard.
7. relationship describes commercial substitutability; discovery_layer describes how far the engine had to broaden.
8. Return a small, defensible set. It is acceptable to return only a few companies in a narrow market.
9. Every rationale must explain fit relative to the buyer intent, not generic company prestige.`

      let resolvedModel = model
      let response = await openai.responses.create({
        model,
        reasoning: { effort: 'medium' },
        prompt_cache_key: openAIPromptCacheKey(project.id, 'competitor'),
        prompt_cache_options: { mode: 'implicit', ttl: '30m' },
        ...(firecrawlKey
          ? {}
          : {
              tools: [{ type: 'web_search_preview' as const, search_context_size: 'medium' as const }],
              tool_choice: 'required' as const,
              include: ['web_search_call.action.sources'],
            }),
        instructions: firecrawlKey
          ? instructions + '\n10. Firecrawl already performed web retrieval. Do not browse again; classify only from the supplied packets.'
          : instructions + '\n10. FIRECRAWL_API_KEY is not configured, so use web search as the temporary retrieval fallback.',
        input: 'Target + approved intent:\n' + JSON.stringify(input)
          + '\n\nRetrieved web evidence:\n' + JSON.stringify(retrievalPackets),
        text: {
          format: {
            type: 'json_schema',
            name: 'riseklix_intent_competitors',
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      })

      await recordOpenAIUsage(ctx.supabase, response, {
        workspaceId: project.workspace_id,
        projectId: project.id,
        researchJobId: job.id,
        stage: 'competitor_discovery_primary',
        model,
        metadata: { intent_id: intent.id, retrieval_provider: firecrawlSources.length ? 'firecrawl' : 'openai_web_search_fallback' },
      })

      let raw = outputText(response)
      if (!raw) throw new Error('Competitor provider returned no structured output')

      let parsed = JSON.parse(raw) as { summary: string; candidates: Candidate[] }
      const targetDomainForEscalation = normalizeDomain(project.domain)
      const retrievedDomains = new Set(
        retrievalPackets
          .map((packet) => normalizeDomain(packet.url))
          .filter((domain) => domain && domain !== targetDomainForEscalation)
      )
      const primaryHasDefensibleShape = parsed.candidates.some((candidate) => candidate.hard_constraints_satisfied && candidate.evidence.length > 0)
      const shouldEscalate = escalationModel !== model && !primaryHasDefensibleShape && retrievedDomains.size >= 4

      if (shouldEscalate) {
        resolvedModel = escalationModel
        response = await openai.responses.create({
          model: escalationModel,
          reasoning: { effort: 'medium' },
          prompt_cache_key: openAIPromptCacheKey(project.id, 'competitor-escalation'),
          prompt_cache_options: { mode: 'implicit', ttl: '30m' },
          ...(firecrawlKey
            ? {}
            : {
                tools: [{ type: 'web_search_preview' as const, search_context_size: 'medium' as const }],
                tool_choice: 'required' as const,
                include: ['web_search_call.action.sources'],
              }),
          instructions: (firecrawlKey
            ? instructions + '\n10. Firecrawl already performed web retrieval. Do not browse again; classify only from the supplied packets.'
            : instructions + '\n10. FIRECRAWL_API_KEY is not configured, so use web search as the temporary retrieval fallback.')
            + '\n11. A cheaper first-pass classifier found no defensible candidate despite a broad retrieval set. Re-evaluate conservatively; zero candidates is still valid if the evidence does not satisfy the hard constraints.',
          input: 'Target + approved intent:\n' + JSON.stringify(input)
            + '\n\nRetrieved web evidence:\n' + JSON.stringify(retrievalPackets),
          text: {
            format: {
              type: 'json_schema',
              name: 'riseklix_intent_competitors',
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
        })

        await recordOpenAIUsage(ctx.supabase, response, {
          workspaceId: project.workspace_id,
          projectId: project.id,
          researchJobId: job.id,
          stage: 'competitor_discovery_escalation',
          model: escalationModel,
          metadata: { intent_id: intent.id, reason: 'broad_retrieval_no_defensible_primary_candidate' },
        })

        raw = outputText(response)
        if (!raw) throw new Error('Competitor escalation model returned no structured output')
        parsed = JSON.parse(raw) as { summary: string; candidates: Candidate[] }
      }

      const searchSources = firecrawlSources.length
        ? firecrawlSources.map((source) => ({ url: source.url, title: source.title }))
        : collectSearchSources(response)
      const sourceMap = new Map<string, { url: string; title: string }>()
      for (const source of searchSources) {
        const key = normalizeUrl(source.url)
        if (key) sourceMap.set(key, source)
      }

      const targetDomain = normalizeDomain(project.domain)
      const validated = dedupe(parsed.candidates)
        .filter((candidate) => candidate.hard_constraints_satisfied)
        .filter((candidate) => normalizeDomain(candidate.domain) !== targetDomain)
        .map((candidate) => {
          const evidence = candidate.evidence
            .map((item) => {
              const key = normalizeUrl(item.url)
              const source = key ? sourceMap.get(key) : null
              return source ? { ...item, url: source.url, title: source.title || item.title } : null
            })
            .filter((item): item is EvidenceItem => Boolean(item))

          return {
            ...candidate,
            evidence,
            evidence_strength: effectiveStrength(candidate.domain, evidence),
          }
        })
        .filter((candidate) => candidate.evidence.length > 0)
        .slice(0, 12)

      const evidenceRows = validated.flatMap((candidate) => candidate.evidence.map((item) => ({
        workspace_id: project.workspace_id,
        project_id: project.id,
        url: item.url,
        title: item.title,
        source_type: 'search_result',
        captured_at: new Date().toISOString(),
        metadata: {
          source_role: 'competitor_discovery',
          intent_id: intent.id,
          intent_key: intent.intent_key,
          candidate_domain: normalizeDomain(candidate.domain),
          claim: item.claim,
          acquisition_method: firecrawlSources.length ? 'firecrawl_search' : 'openai_web_search_fallback',
          retrieval_provider: firecrawlSources.length ? 'firecrawl' : 'openai',
          text_sample: firecrawlSources.find((source) => normalizeUrl(source.url) === normalizeUrl(item.url))?.markdown.slice(0, 12_000) || '',
          discovered_by_model: resolvedModel,
        },
      })))

      const dedupedEvidence = Array.from(new Map(evidenceRows.map((row) => [row.url, row])).values())
      let storedSources: Array<{ id: string; url: string }> = []

      if (dedupedEvidence.length) {
        const stored = await ctx.supabase
          .from('research_sources')
          .upsert(dedupedEvidence, { onConflict: 'project_id,url' })
          .select('id,url')

        if (stored.error) throw stored.error
        storedSources = stored.data ?? []
      }

      const sourceIdByUrl = new Map(storedSources.map((source) => [source.url, source.id]))

      if (body.regenerate) {
        await ctx.supabase
          .from('competitor_candidates')
          .update({ is_current: false })
          .eq('buyer_intent_id', intent.id)
          .eq('is_current', true)
          .not('generation_job_id', 'is', null)
      }

      const rows = validated.map((candidate) => ({
        workspace_id: project.workspace_id,
        project_id: project.id,
        buyer_intent_id: intent.id,
        generation_job_id: job.id,
        company_name: candidate.company_name,
        domain: normalizeDomain(candidate.domain),
        relationship: candidate.relationship,
        discovery_layer: candidate.discovery_layer,
        status: 'verified',
        is_current: true,
        matched_constraints: candidate.matched_constraints,
        relaxed_constraints: candidate.relaxed_constraints,
        evidence: candidate.evidence,
        source_refs: candidate.evidence.map((item) => sourceIdByUrl.get(item.url)).filter(Boolean),
        evidence_strength: candidate.evidence_strength,
        rationale: candidate.rationale,
      }))

      let inserted: Array<{
        id: string
        company_name: string
        domain: string
        relationship: string
        discovery_layer: number
        evidence_strength: string
        source_refs: unknown
      }> = []

      if (rows.length) {
        const result = await ctx.supabase
          .from('competitor_candidates')
          .insert(rows)
          .select('id,company_name,domain,relationship,discovery_layer,evidence_strength,source_refs')

        if (result.error) throw result.error
        inserted = result.data ?? []
      }

      const links = inserted.flatMap((candidate) => {
        const refs = Array.isArray(candidate.source_refs) ? candidate.source_refs : []
        return refs.filter((ref): ref is string => typeof ref === 'string').map((sourceId) => ({
          workspace_id: project.workspace_id,
          project_id: project.id,
          source_id: sourceId,
          entity_type: 'competitor',
          entity_id: candidate.id,
          relation: 'supports',
          claim_text: `Evidence used to establish ${candidate.company_name} as ${candidate.relationship} for ${intent.intent_key}.`,
        }))
      })

      if (links.length) await ctx.supabase.from('evidence_links').insert(links)

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded',
        progress: 100,
        stage: 'competitors_ready',
        output: {
          model: resolvedModel,
          primary_model: model,
          escalation_model: resolvedModel === model ? null : resolvedModel,
          intent_id: intent.id,
          intent_key: intent.intent_key,
          summary: parsed.summary,
          generated: inserted.length,
          source_count: storedSources.length,
          coverage: inserted.length ? 'evidence_backed_candidates' : 'no_defensible_candidates_found',
          source_validation: firecrawlSources.length ? 'firecrawl_retrieval_match' : 'openai_web_search_source_match',
          retrieval_provider: firecrawlSources.length ? 'firecrawl' : 'openai_web_search_fallback',
        },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      await ctx.supabase.from('audit_events').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_user_id: userId,
        event_type: 'intent_competitors_discovered',
        entity_type: 'buyer_intent',
        entity_id: intent.id,
        payload: { research_job_id: job.id, model: resolvedModel, primary_model: model, escalated: resolvedModel !== model, generated: inserted.length, coverage: inserted.length ? 'evidence_backed_candidates' : 'no_defensible_candidates_found' },
      })

      await continueAutopilot(req, project.id)
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown competitor-discovery error'
        await ctx.supabase.from('research_jobs').update({
          status: 'failed',
          stage: 'competitor_discovery_failed',
          error: { message, model },
          completed_at: new Date().toISOString(),
        }).eq('id', job.id)
        await continueAutopilot(req, project.id)
      }
    })()

    EdgeRuntime.waitUntil(discoveryTask)

    return json({
      job: { id: job.id, status: 'running', stage: 'researching_competitor_universe' },
      pending: true,
      message: 'Competitor research started. Riseklix is validating the intent-specific universe in the background.',
    }, 202)
  }),
}

export default handler
