import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

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

    const model = Deno.env.get('RISEKLIX_COMPETITOR_MODEL') || 'gpt-5.6-sol'
    const idempotencyKey = `competitor-discovery:${intent.id}:v${intent.version}:${model}`

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

      const response = await openai.responses.create({
        model,
        reasoning: { effort: 'medium' },
        tools: [{ type: 'web_search_preview', search_context_size: 'medium' }],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        instructions: `You are the intent-specific Competitor Discovery engine for Riseklix Commercial Discovery.\n\nYou must use web search. Do not rely on memorized company lists. Discover companies for ONE approved Buyer Intent, then classify them by a controlled relaxation ladder.\n\nThe evaluated company's overall category is not enough. A competitor is relevant only to this specific buying situation.\n\nLADDER\nL0 DIRECT: satisfies every hard constraint and the important constraints with evidence; same buying job and commercial model.\nL1 NEAR-DIRECT: satisfies every hard constraint and the core buying job; only contextual constraints may be relaxed.\nL2 CONTROLLED RELAXATION: every hard constraint remains satisfied; one or more important constraints may be relaxed. State each relaxation explicitly.\nL3 BROADENED FIT: every hard constraint remains satisfied; broader geography, operating model or delivery approach may be considered only where that item is not itself a hard constraint.\nL4 SUBSTITUTE: solves the buyer's underlying job through a meaningfully different category or approach while still respecting the hard constraints.\nL5 BENCHMARK: useful adjacent benchmark or category leader, clearly not a direct competitor for this exact buying situation.\n\nRULES\n1. NEVER relax a hard constraint. If a company fails one, exclude it entirely.\n2. Search current public evidence for every company. Do not fabricate capabilities, locations, commercial models, certifications, fleet, installation, rental, service coverage or other operating facts.\n3. Copy evidence URLs exactly from pages surfaced through web search. Each included company needs at least one source. Prefer first-party evidence and add independent evidence when useful.\n4. Exclude the evaluated company itself and aliases of its own domain.\n5. Do not intentionally diversify brands. Include the companies that actually fit the intent.\n6. A manufacturer that cannot satisfy a rental intent is not a direct competitor merely because it makes the same equipment. A local rental operator that cannot meet a hard multi-city requirement should be excluded if multi-city is hard.\n7. relationship describes commercial substitutability; discovery_layer describes how far the engine had to broaden.\n8. Return a small, defensible set. It is acceptable to return only a few companies in a narrow market.\n9. Every rationale must explain fit relative to the buyer intent, not generic company prestige.`,
        input: `Research the current competitor universe for this approved Buyer Intent:\n\n${JSON.stringify(input)}`,
        text: {
          format: {
            type: 'json_schema',
            name: 'riseklix_intent_competitors',
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      })

      const raw = outputText(response)
      if (!raw) throw new Error('Competitor provider returned no structured output')

      const parsed = JSON.parse(raw) as { summary: string; candidates: Candidate[] }
      const searchSources = collectSearchSources(response)
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

      if (validated.length < 2) throw new Error('Competitor discovery did not produce enough evidence-backed candidates')

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
          discovered_by_model: model,
        },
      })))

      const dedupedEvidence = Array.from(new Map(evidenceRows.map((row) => [row.url, row])).values())
      const { data: storedSources, error: sourceError } = await ctx.supabase
        .from('research_sources')
        .upsert(dedupedEvidence, { onConflict: 'project_id,url' })
        .select('id,url')

      if (sourceError) throw sourceError
      const sourceIdByUrl = new Map((storedSources ?? []).map((source) => [source.url, source.id]))

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

      const { data: inserted, error: insertError } = await ctx.supabase
        .from('competitor_candidates')
        .insert(rows)
        .select('id,company_name,domain,relationship,discovery_layer,evidence_strength,source_refs')

      if (insertError) throw insertError

      const links = (inserted ?? []).flatMap((candidate) => {
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
          model,
          intent_id: intent.id,
          intent_key: intent.intent_key,
          summary: parsed.summary,
          generated: inserted?.length ?? 0,
          source_count: storedSources?.length ?? 0,
          source_validation: 'web_search_source_match',
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
        payload: { research_job_id: job.id, model, generated: inserted?.length ?? 0 },
      })

        return
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown competitor-discovery error'
        await ctx.supabase.from('research_jobs').update({
          status: 'failed',
          stage: 'competitor_discovery_failed',
          error: { message, model },
          completed_at: new Date().toISOString(),
        }).eq('id', job.id)
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
