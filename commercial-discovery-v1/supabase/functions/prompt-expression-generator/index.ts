import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

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

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function companyAliases(companyName: string, projectName: string, domain: string) {
  const raw = [
    companyName,
    projectName,
    ...companyName.split(/\s*(?:\/|\||&|\band\b)\s*/i),
    ...projectName.split(/\s*(?:\/|\||&|\band\b)\s*/i),
    domain.split('.')[0]?.replace(/[-_]+/g, ' '),
  ]
  const seen = new Set<string>()
  return raw
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .map((item) => ({ raw: item, normalized: normalizedText(item) }))
    .filter((item) => item.normalized.length >= 4)
    .filter((item) => {
      if (seen.has(item.normalized)) return false
      seen.add(item.normalized)
      return true
    })
}

function containsCompanyAlias(text: string, aliases: Array<{ raw: string; normalized: string }>) {
  const normalized = normalizedText(text)
  return aliases.some((alias) => normalized.includes(alias.normalized))
}

const handler = {
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
    const aliases = companyAliases(profile.company_name, project.name, project.domain)
    const aidedAliasInstruction = aliases
      .filter((item) => item.normalized !== normalizedText(project.domain.split('.')[0] || ''))
      .slice(0, 4)
      .map((item) => item.raw)
      .join(' | ')
    const idempotencyKey = `prompt-expression:${intent.id}:v${intent.version}:${languages.join(',')}:${model}:aliases-v2`

    if (!body.regenerate) {
      const existing = await ctx.supabase
        .from('research_jobs')
        .select('id,status,progress,stage,output,error,created_at')
        .eq('project_id', project.id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()

      if (existing.data?.status === 'succeeded') {
        return json({ job: existing.data, reused: true, generated: Number(record(existing.data.output).generated ?? 0) })
      }

      if (existing.data?.status === 'running') {
        const createdAt = new Date(existing.data.created_at).getTime()
        const ageMs = Number.isFinite(createdAt) ? Date.now() - createdAt : 0
        if (ageMs < 90_000) {
          return json({
            job: existing.data,
            pending: true,
            message: 'Buyer-question generation is already running for this situation.',
          }, 202)
        }
      }

      if (existing.data) {
        await ctx.supabase.from('research_jobs').update({
          status: existing.data.status === 'running' ? 'failed' : existing.data.status,
          stage: existing.data.status === 'running' ? 'prompt_generation_interrupted' : existing.data.stage,
          error: existing.data.status === 'running'
            ? { message: 'Previous question-generation request did not finish cleanly.' }
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
        error: 'daily_ai_budget_exceeded',
        message: 'This workspace reached its daily reasoning-model safety limit. Riseklix stopped before making another paid AI request.',
        usage: budgetState,
      }, 429)
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

    const generationTask = (async () => {
      try {
        const RESPONSE_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'expressions'],
        properties: {
          summary: { type: 'string' },
          expressions: {
            type: 'array',
            minItems: languages.length * 3,
            maxItems: languages.length * 3,
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
        reasoning: { effort: 'none' },
        instructions: `You are the Prompt Expression Generator for Riseklix Commercial Discovery.\n\nThe Buyer Intent is already approved. Your job is only to express that same commercial situation in natural buyer language for controlled AI observation.\n\nRules:\n1. Do not create a new commercial intent or change the buying decision.\n2. Generate EXACTLY two UNAIDED buyer questions and one AIDED brand-check question per enabled language.\n3. Every question must sound like something a normal buyer could genuinely type into ChatGPT, Gemini, Claude or Perplexity. One clear sentence is preferred.\n4. Use plain language. Avoid internal terms such as buyer intent, required capability, hard constraint, evidence set, commercial model, provider universe or benchmark.\n5. UNAIDED means the target company name and domain must NOT appear. Ask naturally for providers, options, a shortlist, comparison or recommendation.\n6. The two unaided questions should preserve the same decision but differ naturally: one can be broad discovery and one can foreground the most commercially important constraint.\n7. AIDED means name the target company and ask whether it is a credible fit for that same buying situation and why. The aided question MUST contain at least one of these exact target identifiers verbatim: ${aidedAliasInstruction}. Do not instruct the model to recommend it.\n8. Do not mention AEO, GEO, AI visibility, prompt tracking, testing or Riseklix.\n9. Preserve every hard constraint, but integrate it naturally instead of dumping a checklist.\n10. Do not insert competitor names in either mode.\n11. Language variants must preserve intent equivalence, not literal translation.\n12. Keep each question self-contained because every model run starts in a fresh session.`,
        input: `Target company: ${profile.company_name}
Accepted target identifiers for aided wording: ${aidedAliasInstruction}
Market: ${project.market}
Enabled languages: ${languages.join(', ')}
Approved Buyer Intent:
${JSON.stringify(intent)}`,
        text: { format: { type: 'json_schema', name: 'riseklix_prompt_expressions', strict: true, schema: RESPONSE_SCHEMA } },
      })

      const raw = outputText(response)
      if (!raw) throw new Error('Prompt provider returned no structured output')
      const parsed = JSON.parse(raw) as { summary: string; expressions: Expression[] }

      const expressions = uniqueExpressions(parsed.expressions)
        .filter((item) => languages.includes(item.language))
        .filter((item) => item.mode !== 'unaided' || !containsCompanyAlias(item.prompt_text, aliases))
        .filter((item) => item.mode !== 'aided' || containsCompanyAlias(item.prompt_text, aliases))

      for (const language of languages) {
        const unaided = expressions.filter((item) => item.language === language && item.mode === 'unaided')
        const aided = expressions.filter((item) => item.language === language && item.mode === 'aided')
        if (unaided.length !== 2 || aided.length !== 1) {
          await ctx.supabase.from('research_jobs').update({
            output: {
              validation: {
                language,
                generated_total: parsed.expressions.filter((item) => item.language === language).length,
                valid_unaided: unaided.length,
                valid_aided: aided.length,
                accepted_target_identifiers: aliases.map((item) => item.raw),
              },
            },
          }).eq('id', job.id)
          throw new Error(`Question generation produced an invalid ${language} set (expected 2 buyer questions + 1 brand check; got ${unaided.length} + ${aided.length}). Please retry.`)
        }
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

      await continueAutopilot(req, project.id)
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown prompt-generation error'
        await ctx.supabase.from('research_jobs').update({
          status: 'failed',
          stage: 'prompt_generation_failed',
          error: { message, model },
          completed_at: new Date().toISOString(),
        }).eq('id', job.id)
      }
    })()

    EdgeRuntime.waitUntil(generationTask)

    return json({
      job: { id: job.id, status: 'running', stage: 'generating_prompt_expressions' },
      pending: true,
      message: 'Exact buyer questions are being generated in the background.',
    }, 202)
  }),
}

export default handler
