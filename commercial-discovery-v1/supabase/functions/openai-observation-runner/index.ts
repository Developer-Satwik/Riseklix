import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'
import type { SupabaseClient } from 'npm:@supabase/supabase-js'

type RequestBody = {
  project_id?: string
  benchmark_id?: string
  max_runs?: number
}

type PlannedRun = {
  promptId: string
  buyerIntentId: string
  language: string
  mode: string
  promptText: string
  repetition: number
}

type ExtractedBrand = {
  name: string
  order: number
  in_recommended_set: boolean
}

type Extraction = {
  brands: ExtractedBrand[]
  target_mentioned: boolean
  target_in_recommended_set: boolean
  target_rank: number | null
  answer_type: 'ranked_list' | 'shortlist' | 'comparison' | 'narrative' | 'other'
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

function citationsFromResponse(response: unknown) {
  const value = record(response)
  const output = Array.isArray(value.output) ? value.output : []
  const citations: Array<Record<string, unknown>> = []

  for (const item of output) {
    const content = Array.isArray(record(item).content) ? record(item).content as unknown[] : []
    for (const part of content) {
      const block = record(part)
      const annotations = Array.isArray(block.annotations) ? block.annotations : []
      for (const annotationValue of annotations) {
        const annotation = record(annotationValue)
        if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') continue
        citations.push({
          type: 'url_citation',
          url: annotation.url,
          title: typeof annotation.title === 'string' ? annotation.title : annotation.url,
          start_index: typeof annotation.start_index === 'number' ? annotation.start_index : null,
          end_index: typeof annotation.end_index === 'number' ? annotation.end_index : null,
        })
      }
    }
  }

  const seen = new Set<string>()
  return citations.filter((citation) => {
    const url = String(citation.url)
    if (seen.has(url)) return false
    seen.add(url)
    return true
  })
}

function searchSourcesFromResponse(response: unknown) {
  const value = record(response)
  const output = Array.isArray(value.output) ? value.output : []
  const sources: Array<Record<string, unknown>> = []

  for (const item of output) {
    const block = record(item)
    if (block.type !== 'web_search_call') continue
    const action = record(block.action)
    const actionSources = Array.isArray(action.sources) ? action.sources : []
    for (const sourceValue of actionSources) {
      const source = record(sourceValue)
      if (typeof source.url === 'string') {
        sources.push({ url: source.url, title: typeof source.title === 'string' ? source.title : source.url })
      }
    }
  }

  return sources
}

async function extractBrands(openai: OpenAI, model: string, answer: string, targetCompany: string, competitorNames: string[]): Promise<Extraction> {
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['brands','target_mentioned','target_in_recommended_set','target_rank','answer_type'],
    properties: {
      brands: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name','order','in_recommended_set'],
          properties: {
            name: { type: 'string' },
            order: { type: 'integer', minimum: 1 },
            in_recommended_set: { type: 'boolean' },
          },
        },
      },
      target_mentioned: { type: 'boolean' },
      target_in_recommended_set: { type: 'boolean' },
      target_rank: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
      answer_type: { type: 'string', enum: ['ranked_list','shortlist','comparison','narrative','other'] },
    },
  } as const

  const response = await openai.responses.create({
    model,
    reasoning: { effort: 'none' },
    instructions: `Extract commercial provider mentions from an already-produced AI answer. Do not add, infer or correct brands.\n\nA brand is in_recommended_set only if the answer actually recommends, shortlists, proposes or presents it as a provider/option for the user's buying request. Mere background mention, citation source, comparison reference or prompt-provided target name does not count.\n\nOrder means response order among identifiable brands in the recommended/shortlisted provider set. target_rank must be null unless the target is in that set.`,
    input: `Target company: ${targetCompany}\nKnown intent-specific competitors (matching aid only; do not force them): ${competitorNames.join(', ')}\n\nAnswer to extract:\n${answer}`,
    text: { format: { type: 'json_schema', name: 'riseklix_brand_extraction', strict: true, schema } },
  })

  const raw = outputText(response)
  if (!raw) throw new Error('Brand extractor returned no output')
  return JSON.parse(raw) as Extraction
}

async function benchmarkCompletion(ctx: { supabase: SupabaseClient }, benchmarkId: string) {
  const { data: surfaces } = await ctx.supabase
    .from('benchmark_surfaces')
    .select('status,enabled')
    .eq('benchmark_id', benchmarkId)
    .eq('enabled', true)

  const enabled = surfaces ?? []
  const complete = enabled.length > 0 && enabled.every((item: { status: string }) => item.status === 'complete')
  if (complete) {
    await ctx.supabase.from('benchmarks').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', benchmarkId)
  } else {
    await ctx.supabase.from('benchmarks').update({ status: 'running', completed_at: null }).eq('id', benchmarkId)
  }
  return complete
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    const benchmarkId = body.benchmark_id?.trim()
    const maxRuns = Math.max(1, Math.min(Number(body.max_runs ?? 4), 8))
    if (!projectId || !benchmarkId) return json({ error: 'project_id and benchmark_id are required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'observation_provider_not_configured', message: 'OPENAI_API_KEY is not configured for the OpenAI observation surface.' }, 503)

    const [{ data: project, error: projectError }, { data: benchmark, error: benchmarkError }, { data: profile }] = await Promise.all([
      ctx.supabase.from('projects').select('id,workspace_id,name,market').eq('id', projectId).single(),
      ctx.supabase.from('benchmarks').select('id,status,benchmark_type,version,collection_config').eq('id', benchmarkId).eq('project_id', projectId).single(),
      ctx.supabase.from('company_profile_versions').select('company_name').eq('project_id', projectId).eq('is_current', true).single(),
    ])

    if (projectError || benchmarkError || !project || !benchmark || !profile) return json({ error: 'Project, benchmark or target company not found' }, 404)
    if (!['draft','running'].includes(benchmark.status)) return json({ error: 'benchmark_not_runnable', message: `Benchmark is ${benchmark.status}.` }, 409)

    const config = record(benchmark.collection_config)
    const repetitions = Math.max(1, Math.min(Number(config.repetitions_per_expression ?? 3), 5))
    const observationModel = Deno.env.get('RISEKLIX_OPENAI_OBSERVATION_MODEL') || 'gpt-5.6-luna'
    const extractionModel = Deno.env.get('RISEKLIX_EXTRACTION_MODEL') || 'gpt-5.6-luna'
    const provider = 'openai'
    const surface = 'openai_responses_web_search'

    const { data: members, error: memberError } = await ctx.supabase
      .from('benchmark_prompts')
      .select('buyer_intent_id,prompt_expression_id')
      .eq('benchmark_id', benchmark.id)
    if (memberError || !members?.length) return json({ error: 'benchmark_has_no_prompts' }, 409)

    const promptIds = members.map((member) => member.prompt_expression_id)
    const { data: prompts, error: promptError } = await ctx.supabase
      .from('prompt_expressions')
      .select('id,buyer_intent_id,language,mode,prompt_text,status,is_frozen')
      .in('id', promptIds)
    if (promptError || !prompts?.length) return json({ error: 'Benchmark prompt expressions could not be loaded' }, 409)

    const eligiblePrompts = prompts.filter((prompt) => prompt.status === 'approved' && prompt.is_frozen)
    const expected = eligiblePrompts.length * repetitions

    const { data: surfaceConfig, error: surfaceError } = await ctx.supabase
      .from('benchmark_surfaces')
      .select('id,enabled,status')
      .eq('benchmark_id', benchmark.id)
      .eq('provider', provider)
      .eq('surface', surface)
      .maybeSingle()

    if (surfaceError) return json({ error: surfaceError.message }, 400)
    if (surfaceConfig && !surfaceConfig.enabled) return json({ error: 'surface_disabled', message: 'This observation surface is disabled for the benchmark.' }, 409)

    if (!surfaceConfig) {
      const { error: createSurfaceError } = await ctx.supabase.from('benchmark_surfaces').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        benchmark_id: benchmark.id,
        provider,
        surface,
        model_label: observationModel,
        enabled: true,
        status: 'draft',
        expected_runs: expected,
        metadata: { display_name: 'OpenAI Responses API · free-plan proxy', methodology_note: 'Uses GPT-5.6 Luna by default with no reasoning and automatic web-search tool use as an API approximation of a typical ChatGPT Free interaction. This is not the ChatGPT consumer UI and must not be labeled as such.', model_resolved_at_run: true, consumer_equivalence: 'approximate' },
      })
      if (createSurfaceError) return json({ error: createSurfaceError.message }, 400)
    }

    const { data: existingRuns } = await ctx.supabase
      .from('observation_runs')
      .select('prompt_expression_id,repetition,run_status')
      .eq('benchmark_id', benchmark.id)
      .eq('provider', provider)
      .eq('surface', surface)

    const completedKeys = new Set((existingRuns ?? []).filter((run) => run.run_status === 'captured').map((run) => `${run.prompt_expression_id}:${run.repetition}`))
    const planned: PlannedRun[] = []

    for (const prompt of eligiblePrompts) {
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        const key = `${prompt.id}:${repetition}`
        if (completedKeys.has(key)) continue
        planned.push({ promptId: prompt.id, buyerIntentId: prompt.buyer_intent_id, language: prompt.language, mode: prompt.mode, promptText: prompt.prompt_text, repetition })
      }
    }

    if (!planned.length) {
      const errors = (existingRuns ?? []).filter((run) => run.run_status === 'error').length
      await ctx.supabase.from('benchmark_surfaces').update({
        model_label: observationModel,
        status: 'complete',
        expected_runs: expected,
        captured_runs: completedKeys.size,
        error_runs: errors,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('benchmark_id', benchmark.id).eq('provider', provider).eq('surface', surface)
      const benchmarkComplete = await benchmarkCompletion(ctx, benchmark.id)
      return json({ surface_complete: true, benchmark_complete: benchmarkComplete, captured: completedKeys.size, expected, remaining: 0 })
    }

    const batch = planned.slice(0, maxRuns)
    const observationUnits = Math.max(1, batch.length * 2)
    const budget = await ctx.supabase.rpc('consume_ai_budget', {
      p_project_id: project.id,
      p_kind: 'observation',
      p_units: observationUnits,
    })
    if (budget.error) return json({ error: 'ai_budget_check_failed', message: budget.error.message }, 500)
    const budgetState = record(budget.data)
    if (budgetState.allowed !== true) {
      return json({
        error: 'daily_observation_budget_exceeded',
        message: 'This workspace reached its daily observation safety limit. Riseklix stopped before making more provider or extraction calls.',
        usage: budgetState,
      }, 429)
    }

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      created_by: userId,
      job_type: 'observation_collection',
      status: 'running',
      progress: 0,
      stage: 'openai_observation_batch',
      idempotency_key: `observation:${benchmark.id}:${provider}:${surface}:${crypto.randomUUID()}`,
      input: { benchmark_id: benchmark.id, provider, surface, model: observationModel, extraction_model: extractionModel, batch_size: batch.length },
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start observation batch' }, 400)

    const now = new Date().toISOString()
    await ctx.supabase.from('benchmarks').update({ status: 'running', started_at: now, completed_at: null }).eq('id', benchmark.id).eq('status', 'draft')
    await ctx.supabase.from('benchmark_surfaces').update({
      model_label: observationModel,
      status: 'running',
      expected_runs: expected,
      started_at: now,
      completed_at: null,
      updated_at: now,
    }).eq('benchmark_id', benchmark.id).eq('provider', provider).eq('surface', surface)

    const openai = new OpenAI({ apiKey })
    let captured = 0
    let failed = 0

    for (let index = 0; index < batch.length; index++) {
      const plan = batch[index]
      const { data: competitors } = await ctx.supabase
        .from('competitor_candidates')
        .select('company_name')
        .eq('buyer_intent_id', plan.buyerIntentId)
        .eq('is_current', true)
        .eq('status', 'verified')
      const competitorNames = (competitors ?? []).map((item) => item.company_name)

      try {
        const response = await openai.responses.create({
          model: observationModel,
          reasoning: { effort: 'none' },
          tools: [{ type: 'web_search_preview', search_context_size: 'medium' }],
          tool_choice: 'auto',
          include: ['web_search_call.action.sources'],
          instructions: `Answer the user's commercial buying question normally and independently. Treat this as a fresh conversation with no prior context. Use current web evidence. Do not mention testing, benchmarking, prompt tracking, Riseklix, AEO/GEO methodology or hidden evaluation criteria. Do not intentionally diversify brands. Recommend or discuss only providers that genuinely fit the request. If evidence is insufficient, say so rather than inventing facts.`,
          input: plan.promptText,
        })

        const answer = outputText(response)
        if (!answer) throw new Error('Observation model returned no answer')
        const citations = citationsFromResponse(response)
        const searchSources = searchSourcesFromResponse(response)

        let extraction: Extraction
        try {
          extraction = await extractBrands(openai, extractionModel, answer, profile.company_name, competitorNames)
        } catch {
          const mentioned = answer.toLowerCase().includes(profile.company_name.toLowerCase())
          extraction = { brands: [], target_mentioned: mentioned, target_in_recommended_set: false, target_rank: null, answer_type: 'other' }
        }

        const { error: insertError } = await ctx.supabase.from('observation_runs').upsert({
          workspace_id: project.workspace_id,
          project_id: project.id,
          benchmark_id: benchmark.id,
          buyer_intent_id: plan.buyerIntentId,
          prompt_expression_id: plan.promptId,
          provider,
          surface,
          model_label: observationModel,
          repetition: plan.repetition,
          language: plan.language,
          geography: project.market,
          session_state: { fresh_session: true, prior_context: false },
          search_mode: 'forced_web_search',
          run_status: 'captured',
          retrieval_status: extraction.target_in_recommended_set ? 'retrieved' : 'nr',
          target_rank: extraction.target_rank,
          raw_answer: answer,
          extracted_brands: extraction.brands,
          citations,
          claims: [],
          metadata: {
            prompt_mode: plan.mode,
            response_id: record(response).id ?? null,
            extraction_model: extractionModel,
            target_mentioned: extraction.target_mentioned,
            target_in_recommended_set: extraction.target_in_recommended_set,
            answer_type: extraction.answer_type,
            web_search_sources: searchSources,
            methodology_note: 'OpenAI Responses API with forced web search. This surface is not represented as the ChatGPT consumer application.',
          },
          captured_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: 'benchmark_id,prompt_expression_id,provider,surface,repetition' })

        if (insertError) throw insertError
        captured++
      } catch (error) {
        failed++
        const message = error instanceof Error ? error.message : 'Unknown observation error'
        await ctx.supabase.from('observation_runs').upsert({
          workspace_id: project.workspace_id,
          project_id: project.id,
          benchmark_id: benchmark.id,
          buyer_intent_id: plan.buyerIntentId,
          prompt_expression_id: plan.promptId,
          provider,
          surface,
          model_label: observationModel,
          repetition: plan.repetition,
          language: plan.language,
          geography: project.market,
          session_state: { fresh_session: true, prior_context: false },
          search_mode: 'forced_web_search',
          run_status: 'error',
          retrieval_status: 'unknown',
          raw_answer: null,
          extracted_brands: [],
          citations: [],
          claims: [],
          metadata: { prompt_mode: plan.mode, methodology_note: 'Capture failed; no NR inference made.' },
          error_message: message,
          captured_at: null,
        }, { onConflict: 'benchmark_id,prompt_expression_id,provider,surface,repetition' })
      }

      const progress = Math.round(((index + 1) / batch.length) * 100)
      await ctx.supabase.from('research_jobs').update({ progress, stage: `openai_observation_${index + 1}_of_${batch.length}` }).eq('id', job.id)
    }

    const { data: allRuns } = await ctx.supabase
      .from('observation_runs')
      .select('prompt_expression_id,repetition,run_status')
      .eq('benchmark_id', benchmark.id)
      .eq('provider', provider)
      .eq('surface', surface)

    const capturedKeys = new Set((allRuns ?? []).filter((run) => run.run_status === 'captured').map((run) => `${run.prompt_expression_id}:${run.repetition}`))
    const errorRuns = (allRuns ?? []).filter((run) => run.run_status === 'error').length
    const surfaceComplete = capturedKeys.size >= expected
    const terminalFailure = !surfaceComplete && capturedKeys.size === 0 && errorRuns >= expected

    await ctx.supabase.from('benchmark_surfaces').update({
      model_label: observationModel,
      status: surfaceComplete ? 'complete' : terminalFailure ? 'failed' : 'running',
      expected_runs: expected,
      captured_runs: capturedKeys.size,
      error_runs: errorRuns,
      completed_at: surfaceComplete ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('benchmark_id', benchmark.id).eq('provider', provider).eq('surface', surface)

    const benchmarkComplete = await benchmarkCompletion(ctx, benchmark.id)

    await ctx.supabase.from('research_jobs').update({
      status: failed && !captured ? 'failed' : 'succeeded',
      progress: 100,
      stage: surfaceComplete ? 'openai_surface_complete' : 'openai_observation_batch_complete',
      output: { benchmark_id: benchmark.id, provider, surface, captured, failed, total_captured: capturedKeys.size, expected, surface_complete: surfaceComplete, benchmark_complete: benchmarkComplete },
      error: failed && !captured ? { message: 'All runs in this batch failed' } : {},
      completed_at: new Date().toISOString(),
    }).eq('id', job.id)

    return json({
      benchmark_id: benchmark.id,
      provider,
      surface,
      captured,
      failed,
      total_captured: capturedKeys.size,
      expected,
      remaining: Math.max(expected - capturedKeys.size, 0),
      surface_complete: surfaceComplete,
      benchmark_complete: benchmarkComplete,
    })
  }),
}

export default handler
