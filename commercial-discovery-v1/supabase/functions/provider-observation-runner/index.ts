import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'
import type { SupabaseClient } from 'npm:@supabase/supabase-js'
import { firecrawlSearch, type FirecrawlDocument } from '../_shared/firecrawl.ts'
import { openAIPromptCacheKey, recordOpenAIUsage } from '../_shared/openai-usage.ts'

type Provider = 'google' | 'anthropic' | 'perplexity'
type RequestBody = { project_id?: string; benchmark_id?: string; provider?: Provider; max_runs?: number }

type PlannedRun = {
  promptId: string
  buyerIntentId: string
  language: string
  mode: string
  promptText: string
  repetition: number
}

type ExtractedBrand = { name: string; order: number; in_recommended_set: boolean }
type Extraction = {
  brands: ExtractedBrand[]
  target_mentioned: boolean
  target_in_recommended_set: boolean
  target_rank: number | null
  answer_type: 'ranked_list' | 'shortlist' | 'comparison' | 'narrative' | 'other'
}

type ProviderAnswer = {
  answer: string
  citations: Array<Record<string, unknown>>
  metadata: Record<string, unknown>
}

type BatchExtractionItem = Extraction & { key: string }

type PendingCapture = {
  plan: PlannedRun
  providerAnswer: ProviderAnswer
  competitorNames: string[]
}

const PROVIDERS: Record<Provider, {
  secret: string
  modelEnv: string
  defaultModel: string
  surface: string
  displayName: string
  methodology: string
}> = {
  google: {
    secret: 'GEMINI_API_KEY',
    modelEnv: 'RISEKLIX_GEMINI_OBSERVATION_MODEL',
    defaultModel: 'gemini-3.8-flash',
    surface: 'gemini_generate_content_google_search',
    displayName: 'Gemini API · Flash proxy',
    methodology: 'Gemini API with Google Search grounding. This is an API observation surface, not the Gemini consumer application.',
  },
  anthropic: {
    secret: 'ANTHROPIC_API_KEY',
    modelEnv: 'RISEKLIX_ANTHROPIC_OBSERVATION_MODEL',
    defaultModel: 'claude-haiku-4-5',
    surface: 'anthropic_messages_firecrawl_grounded',
    displayName: 'Claude API · Haiku + Firecrawl',
    methodology: 'Anthropic Messages API using Claude Haiku 4.5 over compact Firecrawl search evidence. This is not Claude consumer search or Anthropic native web search.',
  },
  perplexity: {
    secret: 'PERPLEXITY_API_KEY',
    modelEnv: 'RISEKLIX_PERPLEXITY_OBSERVATION_MODEL',
    defaultModel: 'sonar',
    surface: 'perplexity_sonar',
    displayName: 'Perplexity Sonar API',
    methodology: 'Perplexity Sonar web-grounded API response. This is an API surface and should not be represented as the Perplexity consumer Standard plan.',
  },
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function openAIOutputText(response: unknown) {
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

async function extractBrandsBatch(
  openai: OpenAI,
  model: string,
  items: Array<{ key: string; answer: string; targetCompany: string; competitorNames: string[] }>,
  projectId: string,
) {
  const extractionProperties = {
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
  } as const

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key','brands','target_mentioned','target_in_recommended_set','target_rank','answer_type'],
          properties: { key: { type: 'string' }, ...extractionProperties },
        },
      },
    },
  } as const

  const response = await openai.responses.create({
    model,
    reasoning: { effort: 'none' },
    prompt_cache_key: openAIPromptCacheKey(projectId, 'brand-extraction'),
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    instructions: `Extract commercial provider mentions from several already-produced AI answers.

Do not add, infer or correct brands. Process each item independently. A brand is in_recommended_set only if that answer actually recommends, shortlists, proposes or presents it as a provider/option for the buyer request. Mere background mention, citation source, comparison reference or prompt-provided target name does not count. Order is response order among identifiable brands in the recommended set. target_rank must be null unless the target is in that set. Return one result for every supplied key.`,
    input: JSON.stringify(items),
    text: { format: { type: 'json_schema', name: 'riseklix_brand_extraction_batch', strict: true, schema } },
  })

  const raw = openAIOutputText(response)
  if (!raw) throw new Error('Batch brand extractor returned no output')
  const parsed = JSON.parse(raw) as { items: BatchExtractionItem[] }
  return { response, items: parsed.items }
}

async function extractBrandsFallback(
  openai: OpenAI,
  model: string,
  answer: string,
  targetCompany: string,
  competitorNames: string[],
  projectId: string,
) {
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
    prompt_cache_key: openAIPromptCacheKey(projectId, 'brand-extraction-fallback'),
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    instructions: `Extract commercial provider mentions from an already-produced AI answer. Do not add, infer or correct brands.

A brand is in_recommended_set only if the answer actually recommends, shortlists, proposes or presents it as a provider/option for the user's buying request. Mere background mention, citation source, comparison reference or prompt-provided target name does not count. Order means response order among identifiable brands in the recommended/shortlisted provider set. target_rank must be null unless the target is in that set.`,
    input: `Target company: ${targetCompany}
Known intent-specific competitors (matching aid only; do not force them): ${competitorNames.join(', ')}

Answer to extract:
${answer}`,
    text: { format: { type: 'json_schema', name: 'riseklix_brand_extraction', strict: true, schema } },
  })

  const raw = openAIOutputText(response)
  if (!raw) throw new Error('Brand extractor returned no output')
  return { response, extraction: JSON.parse(raw) as Extraction }
}

async function runGoogle(prompt: string, apiKey: string, model: string): Promise<ProviderAnswer> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(90_000),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(`Gemini API ${response.status}: ${JSON.stringify(payload).slice(0, 900)}`)

  const root = record(payload)
  const candidates = Array.isArray(root.candidates) ? root.candidates : []
  const first = record(candidates[0])
  const content = record(first.content)
  const parts = Array.isArray(content.parts) ? content.parts : []
  const answer = parts.map((part) => record(part).text).filter((item): item is string => typeof item === 'string').join('\n').trim()
  if (!answer) throw new Error('Gemini returned no text answer')

  const grounding = record(first.groundingMetadata)
  const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : []
  const citations = chunks.map((chunk) => {
    const web = record(record(chunk).web)
    if (typeof web.uri !== 'string') return null
    return { type: 'url_citation', url: web.uri, title: typeof web.title === 'string' ? web.title : web.uri }
  }).filter((item): item is Record<string, unknown> => Boolean(item))

  return {
    answer,
    citations,
    metadata: {
      grounding_queries: Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries : [],
      finish_reason: typeof first.finishReason === 'string' ? first.finishReason : null,
    },
  }
}

function firecrawlContext(results: FirecrawlDocument[]) {
  return results.slice(0, 6).map((result, index) => {
    const description = result.description.replace(/\s+/g, ' ').trim().slice(0, 900)
    return [
      `SOURCE ${index + 1}`,
      `Title: ${result.title || 'Untitled'}`,
      `URL: ${result.url}`,
      description ? `Snippet: ${description}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

async function runAnthropic(
  prompt: string,
  apiKey: string,
  model: string,
  searchResults: FirecrawlDocument[],
): Promise<ProviderAnswer> {
  const context = firecrawlContext(searchResults)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(Deno.env.get('ANTHROPIC_WORKSPACE_ID') ? { 'anthropic-workspace-id': Deno.env.get('ANTHROPIC_WORKSPACE_ID') as string } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      system: `Answer the commercial buying question normally and independently.

You have a compact set of current web-search results supplied below. Use them as grounding evidence when relevant, but do not mention Firecrawl, Riseklix, benchmarking, AEO/GEO, prompt testing or hidden evaluation criteria. Do not intentionally diversify brands. Recommend only providers that genuinely fit the buyer request. If the supplied evidence is insufficient for a confident recommendation, say so rather than inventing facts.`,
      messages: [{
        role: 'user',
        content: `${prompt}

CURRENT WEB EVIDENCE
${context || 'No usable search results were returned.'}`,
      }],
    }),
    signal: AbortSignal.timeout(60_000),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${JSON.stringify(payload).slice(0, 900)}`)

  const root = record(payload)
  const blocks = Array.isArray(root.content) ? root.content : []
  const answer = blocks
    .map((blockValue) => {
      const block = record(blockValue)
      return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()

  if (!answer) throw new Error('Claude returned no final text answer')

  return {
    answer,
    citations: searchResults.slice(0, 6).map((result) => ({
      type: 'search_result',
      url: result.url,
      title: result.title || result.url,
    })),
    metadata: {
      stop_reason: root.stop_reason ?? null,
      usage: root.usage ?? null,
      grounding_provider: 'firecrawl_search',
      grounding_result_count: searchResults.length,
      native_anthropic_web_search: false,
    },
  }
}

async function runPerplexity(prompt: string, apiKey: string, model: string): Promise<ProviderAnswer> {
  const agentModel = model.includes('/') ? model : `perplexity/${model}`
  const response = await fetch('https://api.perplexity.ai/v1/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: agentModel,
      input: [
        {
          role: 'system',
          content: 'Answer the commercial buying question normally and independently using current web evidence. Do not mention benchmarking, Riseklix, AEO/GEO, prompt testing or hidden evaluation criteria. Do not intentionally diversify brands. Recommend only providers that genuinely fit the request.',
        },
        { role: 'user', content: prompt },
      ],
      tools: [{ type: 'web_search' }],
      tool_choice: { type: 'web_search' },
      max_steps: 2,
    }),
    signal: AbortSignal.timeout(90_000),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(`Perplexity API ${response.status}: ${JSON.stringify(payload).slice(0, 900)}`)

  const root = record(payload)
  const status = typeof root.status === 'string' ? root.status : 'completed'
  if (status === 'failed' || status === 'cancelled') {
    throw new Error('Perplexity Agent API ' + status + ': ' + JSON.stringify(root.error ?? {}).slice(0, 700))
  }
  if (status === 'incomplete') {
    throw new Error('Perplexity Agent API returned an incomplete response')
  }

  const output = Array.isArray(root.output) ? root.output : []
  const answerParts: string[] = []
  const citations: Array<Record<string, unknown>> = []

  for (const itemValue of output) {
    const item = record(itemValue)

    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : []
      for (const partValue of parts) {
        const part = record(partValue)
        if (part.type === 'output_text' && typeof part.text === 'string') answerParts.push(part.text)

        const annotations = Array.isArray(part.annotations) ? part.annotations : []
        for (const annotationValue of annotations) {
          const annotation = record(annotationValue)
          if (typeof annotation.url === 'string') {
            citations.push({
              type: 'url_citation',
              url: annotation.url,
              title: typeof annotation.title === 'string' ? annotation.title : annotation.url,
            })
          }
        }
      }
    }

    if (item.type === 'search_results') {
      const results = Array.isArray(item.results) ? item.results : []
      for (const resultValue of results) {
        const result = record(resultValue)
        if (typeof result.url === 'string') {
          citations.push({
            type: 'search_result',
            url: result.url,
            title: typeof result.title === 'string' ? result.title : result.url,
            snippet: typeof result.snippet === 'string' ? result.snippet : null,
          })
        }
      }
    }
  }

  const answer = answerParts.join('\n').trim()
  if (!answer) throw new Error('Perplexity Agent API returned no text answer')

  const seen = new Set<string>()
  return {
    answer,
    citations: citations.filter((item) => {
      const url = String(item.url)
      if (seen.has(url)) return false
      seen.add(url)
      return true
    }),
    metadata: {
      usage: root.usage ?? null,
      response_status: status,
      served_model: root.model ?? agentModel,
    },
  }
}

async function benchmarkCompletion(supabase: SupabaseClient, benchmarkId: string) {
  const { data: surfaces } = await supabase
    .from('benchmark_surfaces')
    .select('status,enabled')
    .eq('benchmark_id', benchmarkId)
    .eq('enabled', true)

  const enabled = surfaces ?? []
  const complete = enabled.length > 0 && enabled.every((item: { status: string }) => item.status === 'complete')
  await supabase.from('benchmarks').update({
    status: complete ? 'complete' : 'running',
    completed_at: complete ? new Date().toISOString() : null,
  }).eq('id', benchmarkId)

  return complete
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    const benchmarkId = body.benchmark_id?.trim()
    const provider = body.provider
    const maxRuns = Math.max(1, Math.min(Number(body.max_runs ?? 3), 6))
    if (!projectId || !benchmarkId || !provider || !(provider in PROVIDERS)) {
      return json({ error: 'project_id, benchmark_id and a supported provider are required' }, 400)
    }

    const providerConfig = PROVIDERS[provider]
    const providerKey = Deno.env.get(providerConfig.secret)
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!providerKey) {
      return json({
        error: 'observation_provider_not_configured',
        message: `${providerConfig.secret} is not configured for the ${providerConfig.displayName} observation surface.`,
        provider,
      }, 503)
    }

    if (provider === 'anthropic' && !firecrawlKey) {
      return json({
        error: 'observation_grounding_not_configured',
        message: 'FIRECRAWL_API_KEY is required for the Claude observation surface.',
        provider,
      }, 503)
    }

    const openAIKey = Deno.env.get('OPENAI_API_KEY')
    const extractionModel = Deno.env.get('RISEKLIX_EXTRACTION_MODEL') || 'gpt-5.6-luna'
    const openai = openAIKey ? new OpenAI({ apiKey: openAIKey }) : null
    const observationModel = Deno.env.get(providerConfig.modelEnv) || providerConfig.defaultModel

    const [{ data: project }, { data: benchmark }, { data: profile }] = await Promise.all([
      ctx.supabase.from('projects').select('id,workspace_id,name,market').eq('id', projectId).single(),
      ctx.supabase.from('benchmarks').select('id,status,collection_config').eq('id', benchmarkId).eq('project_id', projectId).single(),
      ctx.supabase.from('company_profile_versions').select('company_name').eq('project_id', projectId).eq('is_current', true).single(),
    ])

    if (!project || !benchmark || !profile) return json({ error: 'Project, benchmark or target company not found' }, 404)
    if (!['draft','running'].includes(benchmark.status)) return json({ error: 'benchmark_not_runnable', message: `Benchmark is ${benchmark.status}.` }, 409)

    const config = record(benchmark.collection_config)
    const repetitions = Math.max(1, Math.min(Number(config.repetitions_per_expression ?? 3), 5))

    const { data: members } = await ctx.supabase
      .from('benchmark_prompts')
      .select('buyer_intent_id,prompt_expression_id')
      .eq('benchmark_id', benchmark.id)
    if (!members?.length) return json({ error: 'benchmark_has_no_prompts' }, 409)

    const promptIds = members.map((member) => member.prompt_expression_id)
    const { data: prompts } = await ctx.supabase
      .from('prompt_expressions')
      .select('id,buyer_intent_id,language,mode,prompt_text,status,is_frozen')
      .in('id', promptIds)
    if (!prompts?.length) return json({ error: 'Benchmark prompt expressions could not be loaded' }, 409)

    const eligiblePrompts = prompts.filter((prompt) => prompt.status === 'approved' && prompt.is_frozen)
    const expected = eligiblePrompts.length * repetitions

    const { data: surfaceConfig } = await ctx.supabase
      .from('benchmark_surfaces')
      .select('id,enabled,status')
      .eq('benchmark_id', benchmark.id)
      .eq('provider', provider)
      .eq('surface', providerConfig.surface)
      .maybeSingle()

    if (!surfaceConfig) return json({ error: 'surface_not_configured', message: `${providerConfig.displayName} is not configured on this benchmark.` }, 409)
    if (!surfaceConfig.enabled) return json({ error: 'surface_disabled', message: `${providerConfig.displayName} is disabled for this benchmark.` }, 409)

    const { data: existingRuns } = await ctx.supabase
      .from('observation_runs')
      .select('prompt_expression_id,repetition,run_status')
      .eq('benchmark_id', benchmark.id)
      .eq('provider', provider)
      .eq('surface', providerConfig.surface)

    const completedKeys = new Set((existingRuns ?? []).filter((run) => run.run_status === 'captured').map((run) => `${run.prompt_expression_id}:${run.repetition}`))
    const planned: PlannedRun[] = []

    for (const prompt of eligiblePrompts) {
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        const key = `${prompt.id}:${repetition}`
        if (completedKeys.has(key)) continue
        planned.push({
          promptId: prompt.id,
          buyerIntentId: prompt.buyer_intent_id,
          language: prompt.language,
          mode: prompt.mode,
          promptText: prompt.prompt_text,
          repetition,
        })
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
      }).eq('id', surfaceConfig.id)
      const benchmarkComplete = await benchmarkCompletion(ctx.supabase, benchmark.id)
      return json({ provider, surface_complete: true, benchmark_complete: benchmarkComplete, captured: completedKeys.size, expected, remaining: 0 })
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
        error: 'observation_budget_exceeded',
        message: budgetState.blocked_scope === 'minute' ? 'Riseklix hit the workspace per-minute observation safety limit. No additional provider or extraction calls were made.' : 'Riseklix hit the workspace daily observation safety limit. No additional provider or extraction calls were made.',
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
      stage: `${provider}_observation_batch`,
      idempotency_key: `observation:${benchmark.id}:${provider}:${providerConfig.surface}:${crypto.randomUUID()}`,
      input: { benchmark_id: benchmark.id, provider, surface: providerConfig.surface, model: observationModel, extraction_model: extractionModel, batch_size: batch.length },
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
    }).eq('id', surfaceConfig.id)

    let captured = 0
    let failed = 0
    const anthropicGroundingCache = new Map<string, Promise<FirecrawlDocument[]>>()
    const pendingCaptures: PendingCapture[] = []

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
        let providerAnswer: ProviderAnswer

        if (provider === 'google') {
          providerAnswer = await runGoogle(plan.promptText, providerKey, observationModel)
        } else if (provider === 'anthropic') {
          let grounding = anthropicGroundingCache.get(plan.promptId)
          if (!grounding) {
            grounding = firecrawlSearch(firecrawlKey as string, plan.promptText, {
              limit: 6,
              location: project.market,
              scrape: false,
            })
            anthropicGroundingCache.set(plan.promptId, grounding)
          }
          providerAnswer = await runAnthropic(plan.promptText, providerKey, observationModel, await grounding)
        } else {
          providerAnswer = await runPerplexity(plan.promptText, providerKey, observationModel)
        }

        pendingCaptures.push({ plan, providerAnswer, competitorNames })
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
          surface: providerConfig.surface,
          model_label: observationModel,
          repetition: plan.repetition,
          language: plan.language,
          geography: project.market,
          session_state: { fresh_session: true, prior_context: false },
          search_mode: provider === 'anthropic' ? 'firecrawl_search_grounding' : 'provider_web_grounding',
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

      await ctx.supabase.from('research_jobs').update({
        progress: Math.max(5, Math.round(((index + 1) / batch.length) * 70)),
        stage: `${provider}_observation_${index + 1}_of_${batch.length}`,
      }).eq('id', job.id)
    }

    const extractionByKey = new Map<string, Extraction>()

    if (pendingCaptures.length && openai) {
      const extractionItems = pendingCaptures.map((item) => ({
        key: `${item.plan.promptId}:${item.plan.repetition}`,
        answer: item.providerAnswer.answer,
        targetCompany: profile.company_name,
        competitorNames: item.competitorNames,
      }))

      try {
        const batchExtraction = await extractBrandsBatch(openai, extractionModel, extractionItems, project.id)
        await recordOpenAIUsage(ctx.supabase, batchExtraction.response, {
          workspaceId: project.workspace_id,
          projectId: project.id,
          researchJobId: job.id,
          stage: 'brand_extraction_batch',
          model: extractionModel,
          metadata: {
            benchmark_id: benchmark.id,
            source_provider: provider,
            answer_count: pendingCaptures.length,
          },
        })
        for (const item of batchExtraction.items) extractionByKey.set(item.key, item)
      } catch {
        // Individual fallback below preserves extraction quality only where needed.
      }
    }

    for (const item of pendingCaptures) {
      const key = `${item.plan.promptId}:${item.plan.repetition}`
      let extraction = extractionByKey.get(key)

      if (!extraction && openai) {
        try {
          const fallback = await extractBrandsFallback(
            openai,
            extractionModel,
            item.providerAnswer.answer,
            profile.company_name,
            item.competitorNames,
            project.id,
          )

          await recordOpenAIUsage(ctx.supabase, fallback.response, {
            workspaceId: project.workspace_id,
            projectId: project.id,
            researchJobId: job.id,
            stage: 'brand_extraction_fallback',
            model: extractionModel,
            metadata: {
              benchmark_id: benchmark.id,
              source_provider: provider,
              prompt_expression_id: item.plan.promptId,
              repetition: item.plan.repetition,
            },
          })
          extraction = fallback.extraction
        } catch {
          // Deterministic mention fallback below.
        }
      }

      if (!extraction) {
        const mentioned = item.providerAnswer.answer.toLowerCase().includes(profile.company_name.toLowerCase())
        extraction = {
          brands: [],
          target_mentioned: mentioned,
          target_in_recommended_set: false,
          target_rank: null,
          answer_type: 'other',
        }
      }

      const { error: insertError } = await ctx.supabase.from('observation_runs').upsert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        benchmark_id: benchmark.id,
        buyer_intent_id: item.plan.buyerIntentId,
        prompt_expression_id: item.plan.promptId,
        provider,
        surface: providerConfig.surface,
        model_label: observationModel,
        repetition: item.plan.repetition,
        language: item.plan.language,
        geography: project.market,
        session_state: { fresh_session: true, prior_context: false },
        search_mode: provider === 'anthropic' ? 'firecrawl_search_grounding' : 'provider_web_grounding',
        run_status: 'captured',
        retrieval_status: extraction.target_in_recommended_set ? 'retrieved' : 'nr',
        target_rank: extraction.target_rank,
        raw_answer: item.providerAnswer.answer,
        extracted_brands: extraction.brands,
        citations: item.providerAnswer.citations,
        claims: [],
        metadata: {
          prompt_mode: item.plan.mode,
          extraction_model: openai ? extractionModel : null,
          target_mentioned: extraction.target_mentioned,
          target_in_recommended_set: extraction.target_in_recommended_set,
          answer_type: extraction.answer_type,
          provider_metadata: item.providerAnswer.metadata,
          methodology_note: providerConfig.methodology,
        },
        captured_at: new Date().toISOString(),
        error_message: null,
      }, { onConflict: 'benchmark_id,prompt_expression_id,provider,surface,repetition' })

      if (insertError) {
        failed++
        await ctx.supabase.from('observation_runs').upsert({
          workspace_id: project.workspace_id,
          project_id: project.id,
          benchmark_id: benchmark.id,
          buyer_intent_id: item.plan.buyerIntentId,
          prompt_expression_id: item.plan.promptId,
          provider,
          surface: providerConfig.surface,
          model_label: observationModel,
          repetition: item.plan.repetition,
          language: item.plan.language,
          geography: project.market,
          session_state: { fresh_session: true, prior_context: false },
          search_mode: provider === 'anthropic' ? 'firecrawl_search_grounding' : 'provider_web_grounding',
          run_status: 'error',
          retrieval_status: 'unknown',
          raw_answer: null,
          extracted_brands: [],
          citations: [],
          claims: [],
          metadata: { prompt_mode: item.plan.mode, methodology_note: 'Capture storage failed; no NR inference made.' },
          error_message: insertError.message,
          captured_at: null,
        }, { onConflict: 'benchmark_id,prompt_expression_id,provider,surface,repetition' })
      } else {
        captured++
      }
    }

    await ctx.supabase.from('research_jobs').update({
      progress: 90,
      stage: `${provider}_extraction_complete`,
    }).eq('id', job.id)

    const { data: allRuns } = await ctx.supabase
      .from('observation_runs')
      .select('prompt_expression_id,repetition,run_status')
      .eq('benchmark_id', benchmark.id)
      .eq('provider', provider)
      .eq('surface', providerConfig.surface)

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
    }).eq('id', surfaceConfig.id)

    const benchmarkComplete = await benchmarkCompletion(ctx.supabase, benchmark.id)

    await ctx.supabase.from('research_jobs').update({
      status: failed && !captured ? 'failed' : 'succeeded',
      progress: 100,
      stage: surfaceComplete ? `${provider}_surface_complete` : `${provider}_observation_batch_complete`,
      output: {
        benchmark_id: benchmark.id,
        provider,
        surface: providerConfig.surface,
        captured,
        failed,
        total_captured: capturedKeys.size,
        expected,
        surface_complete: surfaceComplete,
        benchmark_complete: benchmarkComplete,
      },
      error: failed && !captured ? { message: 'All runs in this batch failed' } : {},
      completed_at: new Date().toISOString(),
    }).eq('id', job.id)

    return json({
      benchmark_id: benchmark.id,
      provider,
      surface: providerConfig.surface,
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
