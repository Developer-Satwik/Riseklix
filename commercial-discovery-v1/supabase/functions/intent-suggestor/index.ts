import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

type IntentRequest = { project_id?: string; regenerate?: boolean }

type SuggestedIntent = {
  title: string
  buyer: string
  job_to_be_done: string
  constraints: Array<{ text: string; importance: 'hard' | 'important' | 'contextual' }>
  required_capabilities: string[]
  geography: { primary: string; scope: string }
  commercial_model: string
  purchase_stage: string
  provenance: 'adapted' | 'exploratory'
  provenance_reason: string
  source_refs: string[]
  priority: 'critical' | 'high' | 'medium' | 'monitor'
  language_policy: { primary: string; suggested_variants: string[]; rationale: string }
}

const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'intents'],
  properties: {
    summary: { type: 'string' },
    intents: {
      type: 'array', minItems: 10, maxItems: 18,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title','buyer','job_to_be_done','constraints','required_capabilities','geography','commercial_model','purchase_stage','provenance','provenance_reason','source_refs','priority','language_policy'],
        properties: {
          title: { type: 'string' },
          buyer: { type: 'string' },
          job_to_be_done: { type: 'string' },
          constraints: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text','importance'], properties: { text: { type: 'string' }, importance: { type: 'string', enum: ['hard','important','contextual'] } } } },
          required_capabilities: { type: 'array', items: { type: 'string' } },
          geography: { type: 'object', additionalProperties: false, required: ['primary','scope'], properties: { primary: { type: 'string' }, scope: { type: 'string' } } },
          commercial_model: { type: 'string' },
          purchase_stage: { type: 'string' },
          provenance: { type: 'string', enum: ['adapted','exploratory'] },
          provenance_reason: { type: 'string' },
          source_refs: { type: 'array', items: { type: 'string' } },
          priority: { type: 'string', enum: ['critical','high','medium','monitor'] },
          language_policy: { type: 'object', additionalProperties: false, required: ['primary','suggested_variants','rationale'], properties: { primary: { type: 'string' }, suggested_variants: { type: 'array', items: { type: 'string' } }, rationale: { type: 'string' } } },
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

function safeSource(source: { id: string; url: string; title: string | null; metadata: unknown }) {
  const metadata = record(source.metadata)
  return {
    ref: source.id,
    url: source.url,
    title: source.title,
    source_role: typeof metadata.source_role === 'string' ? metadata.source_role : 'first_party',
    description: typeof metadata.description === 'string' ? metadata.description.slice(0, 500) : null,
    text_sample: typeof metadata.text_sample === 'string' ? metadata.text_sample.slice(0, 1600) : '',
  }
}

function outputText(response: unknown) {
  const value = record(response)
  if (typeof value.output_text === 'string') return value.output_text
  const output = Array.isArray(value.output) ? value.output : []
  for (const item of output) {
    const content = Array.isArray(record(item).content) ? record(item).content as unknown[] : []
    for (const part of content) {
      const block = record(part)
      if (typeof block.text === 'string') return block.text
    }
  }
  return ''
}

function dedupe(intents: SuggestedIntent[]) {
  const seen = new Set<string>()
  return intents.filter((intent) => {
    const key = `${intent.buyer}|${intent.job_to_be_done}|${intent.commercial_model}|${intent.geography.primary}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: IntentRequest
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
    const projectId = body.project_id?.trim()
    if (!projectId) return json({ error: 'project_id is required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'reasoning_provider_not_configured', message: 'OPENAI_API_KEY is not configured for the intent-suggestor function.' }, 503)

    const { data: project, error: projectError } = await ctx.supabase.from('projects').select('id,workspace_id,name,domain,market,primary_language,enabled_languages').eq('id', projectId).single()
    if (projectError || !project) return json({ error: 'Project not found or access denied' }, 404)

    const { data: profile, error: profileError } = await ctx.supabase.from('company_profile_versions').select('id,version,status,company_name,summary,industry,business_model,products,services,audiences,geographies,claims,evidence,uncertainty').eq('project_id', project.id).eq('is_current', true).single()
    if (profileError || !profile) return json({ error: 'Current Company Intelligence Profile not found' }, 404)
    if (profile.status !== 'approved') return json({ error: 'company_profile_not_approved', message: 'Approve Company Intelligence before generating Buyer Intents.' }, 409)

    const { data: sources } = await ctx.supabase.from('research_sources').select('id,url,title,metadata').eq('project_id', project.id).order('captured_at', { ascending: false }).limit(8)
    const sourcePackets = (sources ?? []).map(safeSource)
    const model = Deno.env.get('RISEKLIX_INTENT_MODEL') || 'gpt-5.6-sol'
    const idempotencyKey = `intent-suggestor:${profile.id}:v${profile.version}:${model}`

    if (!body.regenerate) {
      const existing = await ctx.supabase
        .from('research_jobs')
        .select('id,status,progress,stage,output,created_at')
        .eq('project_id', project.id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()

      if (existing.data?.status === 'succeeded') {
        return json({ job: existing.data, reused: true, generated: Number(record(existing.data.output).generated ?? 0) })
      }

      if (existing.data?.status === 'running') {
        const createdAt = new Date(existing.data.created_at).getTime()
        const ageMs = Number.isFinite(createdAt) ? Date.now() - createdAt : 0

        if (ageMs < 120_000) {
          return json({
            job: existing.data,
            pending: true,
            message: 'Buyer Intent generation is already running. Give the reasoning model a moment, then refresh.',
          }, 202)
        }
      }

      if (existing.data) {
        await ctx.supabase.from('research_jobs').update({
          status: existing.data.status === 'running' ? 'failed' : existing.data.status,
          stage: existing.data.status === 'running' ? 'intent_generation_interrupted' : existing.data.stage,
          error: existing.data.status === 'running'
            ? { message: 'Previous synchronous generation did not finish before the request window closed.' }
            : undefined,
          completed_at: existing.data.status === 'running' ? new Date().toISOString() : undefined,
          idempotency_key: idempotencyKey + ':previous:' + existing.data.id,
        }).eq('id', existing.data.id)
      }
    }

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      created_by: userId,
      job_type: 'intent_generation',
      status: 'running',
      progress: 10,
      stage: 'preparing_company_context',
      idempotency_key: body.regenerate ? `${idempotencyKey}:${crypto.randomUUID()}` : idempotencyKey,
      input: { profile_version_id: profile.id, profile_version: profile.version, source_count: sourcePackets.length, model },
      started_at: new Date().toISOString(),
    }).select('id').single()

    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start intent generation' }, 400)

    try {
      await ctx.supabase.from('research_jobs').update({ progress: 25, stage: 'generating_buyer_intents' }).eq('id', job.id)
      const openai = new OpenAI({ apiKey })
      const companyContext = {
        project: { company: profile.company_name, domain: project.domain, market: project.market, primary_language: project.primary_language, enabled_languages: project.enabled_languages },
        approved_profile: { summary: profile.summary, industry: profile.industry, business_model: profile.business_model, products: profile.products, services: profile.services, audiences: profile.audiences, geographies: profile.geographies, claims: profile.claims, uncertainty: profile.uncertainty },
        evidence_sources: sourcePackets,
      }

      const response = await openai.responses.create({
        model,
        reasoning: { effort: 'medium' },
        instructions: `You are the Buyer Intent Suggestor for Riseklix Commercial Discovery.\n\nModel materially different commercial buying situations, not SEO keywords or prompt paraphrases.\n\nRules:\n1. Treat the approved Company Intelligence Profile as the business premise, but preserve uncertainty and never invent capabilities.\n2. Use supplied evidence refs when a situation is adapted from approved facts. Never claim demand volume, popularity or search frequency unless evidence explicitly provides it.\n3. provenance=adapted means derived from verified/customer-approved business facts. provenance=exploratory means commercially plausible but not evidenced as observed demand. Never mark model-generated intents as observed.\n4. Diversity must come from buyer, job, constraint, transaction model, use case, geography, buying stage or capability—not wording.\n5. Classify constraints as hard, important or contextual. Hard constraints are non-negotiable downstream.\n6. Prioritize revenue-near situations: shortlist, evaluation, vendor consolidation, replacement, purchase-vs-rent, implementation, service availability, technical/safety constraints and supported high-value use cases.\n7. Do not manufacture a problem merely because the company sells something.\n8. Language variants require buyer/audience justification; never recommend local-language testing solely because a company operates in India.\n9. Do not generate named competitors yet.\n10. Aim for 12-16 high-signal intents in this first pass. Prefer distinct commercial decisions over completeness; users can request another pass later.`,
        input: `Build Buyer Intent candidates from this approved company context and source evidence:\n\n${JSON.stringify(companyContext)}`,
        text: { format: { type: 'json_schema', name: 'riseklix_buyer_intents', strict: true, schema: INTENT_SCHEMA } },
      })

      const raw = outputText(response)
      if (!raw) throw new Error('Reasoning provider returned no structured output')
      const parsed = JSON.parse(raw) as { summary: string; intents: SuggestedIntent[] }
      const validSourceIds = new Set(sourcePackets.map((source) => source.ref))
      const intents = dedupe(parsed.intents).slice(0, 24).map((intent) => ({ ...intent, source_refs: intent.source_refs.filter((ref) => validSourceIds.has(ref)) }))
      if (intents.length < 8) throw new Error('Intent Suggestor produced too few distinct commercial situations for review')

      const { data: currentIntents } = await ctx.supabase.from('buyer_intents').select('intent_key').eq('project_id', project.id)
      let nextNo = (currentIntents ?? []).reduce((max, item) => {
        const match = item.intent_key?.match(/INT-(\d+)/)
        return Math.max(max, match ? Number(match[1]) : 0)
      }, 0) + 1

      const rows = intents.map((intent) => ({
        workspace_id: project.workspace_id,
        project_id: project.id,
        profile_version_id: profile.id,
        generation_job_id: job.id,
        source_refs: intent.source_refs,
        intent_key: `INT-${String(nextNo++).padStart(3, '0')}`,
        version: 1,
        status: 'candidate',
        title: intent.title,
        buyer: intent.buyer,
        job_to_be_done: intent.job_to_be_done,
        constraints: intent.constraints,
        required_capabilities: intent.required_capabilities,
        geography: intent.geography,
        commercial_model: intent.commercial_model,
        purchase_stage: intent.purchase_stage,
        provenance: intent.provenance,
        provenance_reason: intent.provenance_reason,
        priority: intent.priority,
        language_policy: intent.language_policy,
      }))

      const { data: inserted, error: insertError } = await ctx.supabase.from('buyer_intents').insert(rows).select('id,intent_key,title,provenance,priority,source_refs')
      if (insertError) throw insertError

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded', progress: 100, stage: 'buyer_intents_ready_for_review',
        output: { model, summary: parsed.summary, generated: intents.length, inserted, usage: record(response).usage ?? null, review_required: true },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      await ctx.supabase.from('audit_events').insert({ workspace_id: project.workspace_id, project_id: project.id, actor_user_id: userId, event_type: 'buyer_intents_suggested', entity_type: 'company_profile', entity_id: profile.id, payload: { research_job_id: job.id, model, generated: intents.length } })

      return json({ job: { id: job.id, status: 'succeeded', stage: 'buyer_intents_ready_for_review' }, summary: parsed.summary, generated: intents.length, intents: inserted, review_required: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown intent-generation error'
      await ctx.supabase.from('research_jobs').update({ status: 'failed', stage: 'intent_generation_failed', error: { message, model }, completed_at: new Date().toISOString() }).eq('id', job.id)
      return json({ error: message, job_id: job.id }, 422)
    }
  }),
}

export default handler
