import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

type RequestBody = {
  project_id?: string
  intent_id?: string
  regenerate?: boolean
}

type Expression = {
  language: string
  mode: 'unaided' | 'aided'
  variant_no: number
  prompt_text: string
  rationale: string
}

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
    const content = Array.isArray(record(item).content) ? record(item).content as unknown[] : []
    for (const part of content) {
      const block = record(part)
      if (typeof block.text === 'string') return block.text
    }
  }
  return ''
}

function uniqueExpressions(expressions: Expression[]) {
  const seen = new Set<string>()
  return expressions.filter((item) => {
    const key = `${item.language}|${item.mode}|${item.prompt_text}`.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    const intentId = body.intent_id?.trim()
    if (!projectId || !intentId) return json({ error: 'project_id and intent_id are required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'reasoning_provider_not_configured', message: 'OPENAI_API_KEY is not configured for prompt generation.' }, 503)

    const [{ data: project, error: projectError }, { data: intent, error: intentError }, { data: profile }] = await Promise.all([
      ctx.supabase.from('projects').select('id,workspace_id,name,domain,market,primary_language,enabled_languages').eq('id', projectId).single(),
      ctx.supabase.from('buyer_intents').select('id,intent_key,version,status,title,buyer,job_to_be_done,constraints,required_capabilities,geography,commercial_model,purchase_stage,language_policy').eq('id', intentId).eq('project_id', projectId).single(),
      ctx.supabase.from('company_profile_versions').select('company_name').eq('project_id', projectId).eq('is_current', true).single(),
    ])

    if (projectError || intentError || !project || !intent || !profile) return json({ error: 'Project, intent or company profile not found' }, 404)
    if (intent.status !== 'approved') return json({ error: 'intent_not_approved', message: 'Approve the Buyer Intent before generating prompt expressions.' }, 409)

    const { count: competitorCount } = await ctx.supabase
      .from('competitor_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_intent_id', intent.id)
      .eq('is_current', true)
      .eq('status', 'verified')

    if (!competitorCount) return json({ error: 'competitor_set_required', message: 'Discover and verify the intent-specific competitor universe before prompt generation.' }, 409)

    const enabled = Array.isArray(project.enabled_languages) ? project.enabled_languages.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
    const languages = Array.from(new Set(enabled.length ? enabled : [project.primary_language || 'English'])).slice(0, 4)
    const model = Deno.env.get('RISEKLIX_PROMPT_MODEL') || 'gpt-5.6-luna'
    const idempotencyKey = `prompt-expression:${intent.id}:v${intent.version}:${languages.join(',')}:${model}`

    if (!body.regenerate) {
      const existing = await ctx.supabase.from('research_jobs').select('id,status,progress,stage,output').eq('project_id', project.id).eq('idempotency_key', idempotencyKey).maybeSingle()
      if (existing.data?.status === 'succeeded') return json({ job: existing.data, reused: true, generated: Number(record(existing.data.output).generated ?? 0) })
    }

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      created_by: userId,
      job_type: 'prompt_generation',
      status: 'running',
      progress: 10,
      stage: 'preparing_prompt_context',
      idempotency_key: body.regenerate ? `${idempotencyKey}:${crypto.randomUUID()}` : idempotencyKey,
      input: { intent_id: intent.id, intent_key: intent.intent_key, intent_version: intent.version, languages, model },
      started_at: new Date().toISOString(),
    }).select('id').single()

    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start prompt generation' }, 400)

    try {
      const RESPONSE_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'expressions'],
        properties: {
          summary: { type: 'string' },
          expressions: {
            type: 'array',
            minItems: languages.length * 2,
            maxItems: languages.length * 4,
            items: {
              type: 'object', additionalProperties: false,
              required: ['language','mode','variant_no','prompt_text','rationale'],
              properties: {
                language: { type: 'string', enum: languages },
                mode: { type: 'string', enum: ['unaided','aided'] },
                variant_no: { type: 'integer', minimum: 1, maximum: 4 },
                prompt_text: { type: 'string' },
                rationale: { type: 'string' },
              },
            },
          },
        },
      } as const

      await ctx.supabase.from('research_jobs').update({ progress: 30, stage: 'generating_prompt_expressions' }).eq('id', job.id)

      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model,
        reasoning: { effort: 'medium' },
        instructions: `You are the Prompt Expression Generator for Riseklix Commercial Discovery.\n\nThe Buyer Intent is already approved. Your job is only to express that same commercial situation in natural buyer language for controlled AI observation.\n\nRules:\n1. Do not create new buyer intents or change the commercial situation.\n2. Generate exactly two UNAIDED expressions and one AIDED expression per enabled language where possible.\n3. UNAIDED means the target company name and domain must NOT appear. The prompt should ask naturally for providers, options, a shortlist, comparison or recommendation in the buying situation.\n4. AIDED means ask whether the target company is a credible fit for the same situation, what it appears to offer, and any evidence/limitations relevant to that fit. Do not tell the model to recommend the company.\n5. Do not mention AEO, GEO, AI visibility, prompt tracking, testing or this research methodology in the buyer wording.\n6. Do not stuff category terms. Write like a real procurement, operations, owner or commercial buyer would ask.\n7. Language variants must preserve intent equivalence, not literal translation. Hinglish should sound naturally code-switched; Hindi should be natural Hindi for the buyer context.\n8. Preserve hard constraints in every expression. Important constraints should normally remain; contextual constraints may vary naturally.\n9. Do not insert competitor names in either mode.\n10. Keep each expression self-contained because every observation may run in a fresh session.`,
        input: `Target company: ${profile.company_name}\nMarket: ${project.market}\nEnabled languages: ${languages.join(', ')}\nApproved Buyer Intent:\n${JSON.stringify(intent)}`,
        text: { format: { type: 'json_schema', name: 'riseklix_prompt_expressions', strict: true, schema: RESPONSE_SCHEMA } },
      })

      const raw = outputText(response)
      if (!raw) throw new Error('Prompt provider returned no structured output')
      const parsed = JSON.parse(raw) as { summary: string; expressions: Expression[] }
      const targetName = profile.company_name.toLowerCase()

      const expressions = uniqueExpressions(parsed.expressions)
        .filter((item) => languages.includes(item.language))
        .filter((item) => item.mode !== 'unaided' || !item.prompt_text.toLowerCase().includes(targetName))
        .filter((item) => item.mode !== 'aided' || item.prompt_text.toLowerCase().includes(targetName))

      for (const language of languages) {
        const unaided = expressions.filter((item) => item.language === language && item.mode === 'unaided')
        const aided = expressions.filter((item) => item.language === language && item.mode === 'aided')
        if (unaided.length < 1 || aided.length < 1) throw new Error(`Prompt generation failed equivalence checks for ${language}`)
      }

      if (body.regenerate) {
        await ctx.supabase.from('prompt_expressions').delete().eq('buyer_intent_id', intent.id).eq('status', 'candidate').eq('is_frozen', false)
      }

      const rows = expressions.map((item) => ({
        workspace_id: project.workspace_id,
        project_id: project.id,
        buyer_intent_id: intent.id,
        generation_job_id: job.id,
        version: intent.version,
        variant_no: item.variant_no,
        language: item.language,
        mode: item.mode,
        prompt_text: item.prompt_text,
        status: 'candidate',
        is_frozen: false,
      }))

      const { data: inserted, error: insertError } = await ctx.supabase.from('prompt_expressions').insert(rows).select('id,language,mode,variant_no,prompt_text,status')
      if (insertError) throw insertError

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded', progress: 100, stage: 'prompt_expressions_ready_for_review',
        output: { model, summary: parsed.summary, generated: inserted?.length ?? 0, languages, review_required: true },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      await ctx.supabase.from('audit_events').insert({ workspace_id: project.workspace_id, project_id: project.id, actor_user_id: userId, event_type: 'prompt_expressions_generated', entity_type: 'buyer_intent', entity_id: intent.id, payload: { research_job_id: job.id, model, generated: inserted?.length ?? 0, languages } })

      return json({ job: { id: job.id, status: 'succeeded', stage: 'prompt_expressions_ready_for_review' }, summary: parsed.summary, generated: inserted?.length ?? 0, expressions: inserted, review_required: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown prompt-generation error'
      await ctx.supabase.from('research_jobs').update({ status: 'failed', stage: 'prompt_generation_failed', error: { message, model }, completed_at: new Date().toISOString() }).eq('id', job.id)
      return json({ error: message, job_id: job.id }, 422)
    }
  }),
}
