import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

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
  claims: Array<{ claim: string; source_refs: string[]; support: 'supported' | 'uncertain'; note: string }>
  evidence: Array<{ fact: string; source_refs: string[] }>
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
        type: 'object', additionalProperties: false, required: ['claim','source_refs','support','note'],
        properties: {
          claim: { type: 'string' },
          source_refs: { type: 'array', items: { type: 'string' } },
          support: { type: 'string', enum: ['supported','uncertain'] },
          note: { type: 'string' },
        },
      },
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['fact','source_refs'],
        properties: { fact: { type: 'string' }, source_refs: { type: 'array', items: { type: 'string' } } },
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

function sourcePacket(source: { id: string; url: string; title: string | null; metadata: unknown }) {
  const metadata = record(source.metadata)
  return {
    ref: source.id,
    url: source.url,
    title: source.title,
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
      ctx.supabase.from('research_sources').select('id,url,title,metadata').eq('project_id', projectId).eq('source_type', 'first_party').order('captured_at', { ascending: false }).limit(14),
    ])

    if (projectError || profileError || sourceError || !project || !profile) return json({ error: 'Project context could not be loaded' }, 404)
    if (profile.status === 'approved') return json({ error: 'approved_profile_is_immutable', message: 'The current Company Intelligence Profile is already approved. Edit it before requesting a new interpretation.' }, 409)
    if (!sources?.length) return json({ error: 'no_company_evidence', message: 'Capture first-party company evidence before interpretation.' }, 409)

    const packets = sources.map(sourcePacket).filter((source) => source.text_sample.length > 60)
    if (!packets.length) return json({ error: 'no_usable_company_evidence' }, 409)

    const model = Deno.env.get('RISEKLIX_COMPANY_MODEL') || 'gpt-5.6-sol'
    const sourceSignature = packets.map((source) => source.ref).sort().join(':')
    const idempotencyKey = body.regenerate
      ? 'company-interpretation:' + profile.id + ':v' + profile.version + ':' + model + ':' + crypto.randomUUID()
      : 'company-interpretation:' + profile.id + ':v' + profile.version + ':' + model + ':' + sourceSignature

    if (!body.regenerate) {
      const existing = await ctx.supabase.from('research_jobs').select('id,status,stage,progress,output').eq('project_id', project.id).eq('idempotency_key', idempotencyKey).maybeSingle()
      if (existing.data?.status === 'succeeded') return json({ job: existing.data, reused: true })
    }

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id, project_id: project.id, created_by: userId, job_type: 'company_research',
      status: 'running', progress: 10, stage: 'interpreting_company_evidence', idempotency_key: idempotencyKey,
      input: { profile_version_id: profile.id, model, source_refs: packets.map((source) => source.ref) },
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start Company Intelligence interpretation' }, 400)

    try {
      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model,
        reasoning: { effort: 'high' },
        instructions: `You are the Company Intelligence interpreter for Riseklix Commercial Discovery.

Your job is to reconstruct the company's commercial reality from supplied FIRST-PARTY evidence before Buyer Intent generation.

Rules:
1. Use only the supplied source packets. Do not perform outside research in this step and do not use unstated general knowledge to fill gaps.
2. Separate facts supported by the evidence from uncertainty. If geography, service capacity, customer type, commercial model, certifications or operational claims are not explicit enough, place the gap in uncertainty.
3. Do not turn marketing adjectives into verified capabilities.
4. Products are things sold or supplied. Services describe how customers engage, such as rental, implementation, installation, consulting, support or project delivery.
5. Audiences must be supported by explicit industry/customer/use-case evidence; do not invent personas from generic category assumptions.
6. Geographies should reflect evidence actually present. Never infer pan-national or local coverage from a generic contact page.
7. The summary should be concise, commercial and neutral. It should explain what the company appears to provide, to whom, and how customers buy where supported.
8. Every claim and evidence fact must cite source_refs from the supplied packets.
9. 'supported' means directly supported by supplied first-party evidence, not independently verified truth. Use 'uncertain' when the source language is incomplete or promotional.
10. Preserve contradictions or missing detail in uncertainty rather than resolving them silently.`,
        input: 'Project context:\n' + JSON.stringify({
          domain: project.domain, market: project.market, primary_language: project.primary_language,
          enabled_languages: project.enabled_languages, current_company_name: profile.company_name,
          user_supplied_industry_hint: profile.industry,
        }) + '\n\nFirst-party source packets:\n' + JSON.stringify(packets),
        text: { format: { type: 'json_schema', name: 'riseklix_company_intelligence', strict: true, schema: COMPANY_SCHEMA } },
      })

      const raw = outputText(response)
      if (!raw) throw new Error('Company Intelligence provider returned no structured output')
      const interpreted = JSON.parse(raw) as CompanyIntelligence
      const validRefs = new Set(packets.map((source) => source.ref))
      const safeRefs = (refs: string[]) => refs.filter((ref) => validRefs.has(ref))
      const claims = interpreted.claims.map((claim) => ({ ...claim, source_refs: safeRefs(claim.source_refs) }))
      const evidence = interpreted.evidence.map((item) => ({ ...item, source_refs: safeRefs(item.source_refs) }))

      const { error: updateError } = await ctx.supabase.from('company_profile_versions').update({
        company_name: interpreted.company_name, summary: interpreted.summary, industry: interpreted.industry || null,
        business_model: interpreted.business_model || null, products: interpreted.products, services: interpreted.services,
        audiences: interpreted.audiences, geographies: interpreted.geographies, claims, evidence, uncertainty: interpreted.uncertainty,
        status: 'draft', approved_by: null, approved_at: null,
      }).eq('id', profile.id)
      if (updateError) throw updateError

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded', progress: 100, stage: 'company_intelligence_ready_for_review',
        output: { model, profile_version_id: profile.id, source_count: packets.length, company_name: interpreted.company_name, uncertainty_count: interpreted.uncertainty.length, usage: record(response).usage ?? null, review_required: true },
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

      return json({ job: { id: job.id, status: 'succeeded', stage: 'company_intelligence_ready_for_review' }, profile: { id: profile.id, company_name: interpreted.company_name, uncertainty_count: interpreted.uncertainty.length }, review_required: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Company Intelligence interpretation error'
      await ctx.supabase.from('research_jobs').update({ status: 'failed', stage: 'company_intelligence_interpretation_failed', error: { message, model }, completed_at: new Date().toISOString() }).eq('id', job.id)
      return json({ error: message, job_id: job.id }, 422)
    }
  }),
}

export default handler
