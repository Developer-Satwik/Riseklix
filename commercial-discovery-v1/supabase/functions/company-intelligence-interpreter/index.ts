import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'
import { firecrawlSearch, type FirecrawlDocument } from '../_shared/firecrawl.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

type RequestBody = { project_id?: string; regenerate?: boolean }

type CompanyIntelligence = {
  company_name: string
  summary: string
  industry: string
  business_model: string
  products: string[]
  services: string[]
  audiences: string[]
  geographies: string[]
  claims: Array<{ claim: string; source_urls: string[]; support: 'supported' | 'uncertain'; note: string }>
  evidence: Array<{ fact: string; source_urls: string[] }>
  uncertainty: string[]
}

const COMPANY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['company_name','summary','industry','business_model','products','services','audiences','geographies','claims','evidence','uncertainty'],
  properties: {
    company_name: { type: 'string' },
    summary: { type: 'string' },
    industry: { type: 'string' },
    business_model: { type: 'string' },
    products: { type: 'array', items: { type: 'string' } },
    services: { type: 'array', items: { type: 'string' } },
    audiences: { type: 'array', items: { type: 'string' } },
    geographies: { type: 'array', items: { type: 'string' } },
    claims: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['claim','source_urls','support','note'],
        properties: {
          claim: { type: 'string' },
          source_urls: { type: 'array', items: { type: 'string' } },
          support: { type: 'string', enum: ['supported','uncertain'] },
          note: { type: 'string' },
        },
      },
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['fact','source_urls'],
        properties: { fact: { type: 'string' }, source_urls: { type: 'array', items: { type: 'string' } } },
      },
    },
    uncertainty: { type: 'array', items: { type: 'string' } },
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
      if (typeof candidate.url !== 'string') continue
      sources.push({
        url: candidate.url,
        title: typeof candidate.title === 'string' ? candidate.title : candidate.url,
      })
    }
  }

  return sources
}

function outputText(response: unknown) {
  const value = record(response)
  if (typeof value.output_text === 'string') return value.output_text
  const output = Array.isArray(value.output) ? value.output : []
  for (const item of output) {
    const message = record(item)
    const parts = Array.isArray(message.content) ? message.content : []
    for (const part of parts) {
      const block = record(part)
      if (typeof block.text === 'string') return block.text
    }
  }
  return ''
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

function sourcePacket(source: { id: string; url: string; title: string | null; source_type: string; metadata: unknown }) {
  const metadata = record(source.metadata)
  return {
    ref: source.id,
    url: source.url,
    title: source.title,
    source_type: source.source_type,
    acquisition_method: typeof metadata.acquisition_method === 'string' ? metadata.acquisition_method : 'direct_first_party_fetch',
    source_role: typeof metadata.source_role === 'string' ? metadata.source_role : 'first_party',
    description: typeof metadata.description === 'string' ? metadata.description.slice(0, 900) : '',
    text_sample: typeof metadata.text_sample === 'string' ? metadata.text_sample.slice(0, 6500) : '',
  }
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
    const projectId = body.project_id?.trim()
    if (!projectId) return json({ error: 'project_id is required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'reasoning_provider_not_configured', message: 'OPENAI_API_KEY is not configured for Company Intelligence interpretation.' }, 503)

    const [{ data: project, error: projectError }, { data: profile, error: profileError }, { data: sources, error: sourceError }] = await Promise.all([
      ctx.supabase.from('projects').select('id,workspace_id,name,domain,market,primary_language,enabled_languages').eq('id', projectId).single(),
      ctx.supabase.from('company_profile_versions').select('id,version,status,company_name,industry').eq('project_id', projectId).eq('is_current', true).single(),
      ctx.supabase.from('research_sources').select('id,url,title,source_type,metadata').eq('project_id', projectId).in('source_type', ['first_party','search_result']).order('captured_at', { ascending: false }).limit(14),
    ])

    if (projectError || profileError || sourceError || !project || !profile) return json({ error: 'Project context could not be loaded' }, 404)
    if (profile.status === 'approved') return json({ error: 'approved_profile_is_immutable', message: 'The current Company Intelligence Profile is already approved. Edit it before requesting a new interpretation.' }, 409)
    const packets = (sources ?? [])
      .map(sourcePacket)
      .filter((source) => source.text_sample.length > 60)
      .filter((source) => source.source_type === 'first_party' || source.acquisition_method === 'indexed_first_party_fallback')

    const model = Deno.env.get('RISEKLIX_COMPANY_MODEL') || 'gpt-5.6-sol'
    const sourceSignature = packets.length ? packets.map((source) => source.ref).sort().join(':') : 'outside-in-only'
    const idempotencyKey = body.regenerate
      ? 'company-interpretation:' + profile.id + ':v' + profile.version + ':' + model + ':' + crypto.randomUUID()
      : 'company-interpretation:' + profile.id + ':v' + profile.version + ':' + model + ':' + sourceSignature

    if (!body.regenerate) {
      const existing = await ctx.supabase.from('research_jobs').select('id,status,stage,progress,output').eq('project_id', project.id).eq('idempotency_key', idempotencyKey).maybeSingle()
      if (existing.data?.status === 'succeeded') return json({ job: existing.data, reused: true })
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
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id, project_id: project.id, created_by: userId, job_type: 'company_research',
      status: 'running', progress: 10, stage: 'interpreting_company_evidence', idempotency_key: idempotencyKey,
      input: { profile_version_id: profile.id, model, source_refs: packets.map((source) => source.ref) },
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start Company Intelligence interpretation' }, 400)

    const interpretationTask = (async () => {
      try {
        await ctx.supabase.from('research_jobs').update({
          progress: 28,
          stage: 'verifying_company_outside_in',
        }).eq('id', job.id)

        const openai = new OpenAI({ apiKey })
        const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
        let firecrawlSources: FirecrawlDocument[] = []

        if (firecrawlKey) {
          const companyName = profile.company_name || project.name
          const country = marketCountry(project.market)
          const queries = [
            companyName + ' ' + project.domain + ' company products services',
            companyName + ' ' + project.market + ' customers locations capabilities',
          ]

          const searched = await Promise.all(
            queries.map((query) => firecrawlSearch(firecrawlKey, query, {
              limit: 5,
              location: country,
              scrape: true,
            }))
          )
          firecrawlSources = uniqueFirecrawlDocs(searched).slice(0, 10)
        }

        const outsideInPackets = firecrawlSources.map((source) => ({
          url: source.url,
          title: source.title,
          description: source.description,
          text_sample: source.markdown.slice(0, 6500),
          acquisition_method: 'firecrawl_search',
        }))

        const baseInstructions = `You are the Company Intelligence interpreter for Riseklix Commercial Discovery.

Your job is to reconstruct the company's commercial reality using supplied evidence before Buyer Intent generation.

Rules:
1. Treat evidence in layers: (a) direct or rendered first-party captures, (b) indexed/search-discovered first-party evidence, (c) independent external evidence such as reputable directories, trade/industry sources, client/customer references, registries, press or other public corroboration.
2. Prefer first-party evidence for what the company claims. Use independent sources to corroborate, challenge or qualify those claims where possible.
3. Never infer a capability merely because a third-party page categorizes the company broadly. A material capability should be explicit in at least one relevant source.
4. If first-party and external evidence disagree, preserve the disagreement in uncertainty instead of silently resolving it.
5. Do not turn marketing adjectives into verified capabilities.
6. Products are things sold or supplied. Services describe how customers engage, such as rental, implementation, installation, consulting, support or project delivery.
7. Audiences must be supported by explicit customer, industry, use-case or commercial evidence; do not invent personas from generic category assumptions.
8. Geographies should reflect evidence actually present. Never infer national or local coverage from a generic contact page.
9. Every claim and evidence fact must cite source_urls. Use exact URLs from supplied evidence or retrieved search sources.
10. 'supported' means supported by the evidence set, not independently proven truth. Weak or conflicting support belongs in uncertainty.
11. The summary should be concise, commercial and neutral: what the company provides, who it appears to serve, where, and how customers buy.
12. The research objective is not to make the company look good. It is to reconstruct what a serious buyer or AI system could verify publicly.`

        const response = await openai.responses.create({
          model,
          reasoning: { effort: 'medium' },
          ...(firecrawlKey
            ? {}
            : {
                tools: [{ type: 'web_search_preview' as const, search_context_size: 'medium' as const }],
                tool_choice: 'required' as const,
                include: ['web_search_call.action.sources'],
              }),
          instructions: firecrawlKey
            ? baseInstructions + '\n13. Web retrieval was performed before this reasoning call by Firecrawl. Do not browse again; reason only over the supplied retrieval packets.'
            : baseInstructions + '\n13. FIRECRAWL_API_KEY is not configured, so use web search as the temporary outside-in retrieval fallback.',
          input: 'Project context:\n' + JSON.stringify({
            domain: project.domain,
            market: project.market,
            primary_language: project.primary_language,
            enabled_languages: project.enabled_languages,
            current_company_name: profile.company_name,
            user_supplied_industry_hint: profile.industry,
          }) + '\n\nExisting company-evidence packets:\n' + JSON.stringify(packets)
            + '\n\nOutside-in retrieval packets:\n' + JSON.stringify(outsideInPackets),
          text: { format: { type: 'json_schema', name: 'riseklix_company_intelligence', strict: true, schema: COMPANY_SCHEMA } },
        })

        const raw = outputText(response)
        if (!raw) throw new Error('Company Intelligence provider returned no structured output')
        const interpreted = JSON.parse(raw) as CompanyIntelligence

        const searchSources = firecrawlSources.length
          ? firecrawlSources.map((source) => ({ url: source.url, title: source.title }))
          : collectSearchSources(response)
        const existingByUrl = new Map<string, string>()
        for (const source of (sources ?? [])) {
          const key = normalizeUrl(source.url)
          if (key) existingByUrl.set(key, source.id)
        }

        const discoveredRows = Array.from(new Map(
          searchSources
            .filter((source) => normalizeUrl(source.url))
            .map((source) => [normalizeUrl(source.url) as string, {
              workspace_id: project.workspace_id,
              project_id: project.id,
              url: source.url,
              title: source.title,
              source_type: 'search_result',
              captured_at: new Date().toISOString(),
              metadata: {
                source_role: 'outside_in_verification',
                acquisition_method: firecrawlSources.length ? 'firecrawl_search' : 'openai_web_search_fallback',
                retrieval_provider: firecrawlSources.length ? 'firecrawl' : 'openai',
                text_sample: firecrawlSources.find((item) => normalizeUrl(item.url) === normalizeUrl(source.url))?.markdown.slice(0, 12_000) || '',
                discovered_by_model: model,
              },
            }])
        ).values())

        let storedSearchSources: Array<{ id: string; url: string }> = []
        if (discoveredRows.length) {
          const { data: stored, error: storeError } = await ctx.supabase
            .from('research_sources')
            .upsert(discoveredRows, { onConflict: 'project_id,url' })
            .select('id,url')
          if (storeError) throw storeError
          storedSearchSources = stored ?? []
        }

        const sourceIdByUrl = new Map(existingByUrl)
        for (const source of storedSearchSources) {
          const key = normalizeUrl(source.url)
          if (key) sourceIdByUrl.set(key, source.id)
        }

        const mapUrls = (urls: string[]) => Array.from(new Set(
          urls
            .map((url) => normalizeUrl(url))
            .filter((url): url is string => Boolean(url))
            .map((url) => sourceIdByUrl.get(url))
            .filter((id): id is string => typeof id === 'string')
        ))

        const claims = interpreted.claims.map((claim) => ({
          claim: claim.claim,
          source_refs: mapUrls(claim.source_urls),
          support: claim.support,
          note: claim.note,
        }))
        const evidence = interpreted.evidence.map((item) => ({
          fact: item.fact,
          source_refs: mapUrls(item.source_urls),
        }))

        const { error: updateError } = await ctx.supabase.from('company_profile_versions').update({
        company_name: interpreted.company_name, summary: interpreted.summary, industry: interpreted.industry || null,
        business_model: interpreted.business_model || null, products: interpreted.products, services: interpreted.services,
        audiences: interpreted.audiences, geographies: interpreted.geographies, claims, evidence, uncertainty: interpreted.uncertainty,
        status: 'draft', approved_by: null, approved_at: null,
      }).eq('id', profile.id)
      if (updateError) throw updateError

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded', progress: 100, stage: 'company_intelligence_ready_for_review',
        output: { model, profile_version_id: profile.id, supplied_source_count: packets.length, outside_in_source_count: storedSearchSources.length, company_name: interpreted.company_name, uncertainty_count: interpreted.uncertainty.length, usage: record(response).usage ?? null, review_required: true, outside_in_search: true, retrieval_provider: firecrawlSources.length ? 'firecrawl' : 'openai_web_search_fallback' },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      await Promise.all([
        ctx.supabase.from('projects').update({ status: 'profile_review', updated_at: new Date().toISOString() }).eq('id', project.id),
        ctx.supabase.from('audit_events').insert({
          workspace_id: project.workspace_id, project_id: project.id, actor_user_id: userId,
          event_type: 'company_intelligence_interpreted', entity_type: 'company_profile', entity_id: profile.id,
          payload: { research_job_id: job.id, model, source_count: packets.length },
        }),
      ])

        return
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown Company Intelligence interpretation error'
        await ctx.supabase.from('research_jobs').update({
          status: 'failed',
          stage: 'company_intelligence_interpretation_failed',
          error: { message, model },
          completed_at: new Date().toISOString(),
        }).eq('id', job.id)
      }
    })()

    EdgeRuntime.waitUntil(interpretationTask)

    return json({
      job: { id: job.id, status: 'running', stage: 'verifying_company_outside_in' },
      pending: true,
      message: 'Company evidence captured. Riseklix is now verifying the company across the public web in the background.',
    }, 202)
  }),
}

export default handler
