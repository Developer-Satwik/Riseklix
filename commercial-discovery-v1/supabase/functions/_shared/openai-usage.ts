import type { SupabaseClient } from 'npm:@supabase/supabase-js'

type UsageContext = {
  workspaceId: string
  projectId: string
  researchJobId?: string | null
  stage: string
  model: string
  serviceTier?: string | null
  metadata?: Record<string, unknown>
}

type Price = {
  input: number
  cached: number
  cacheWrite: number
  output: number
}

const STANDARD_PRICES: Record<string, Price> = {
  'gpt-5.6-sol': { input: 4, cached: 0.4, cacheWrite: 5, output: 20 },
  'gpt-5.6': { input: 4, cached: 0.4, cacheWrite: 5, output: 20 },
  'gpt-5.6-terra': { input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function countWebSearchCalls(response: unknown) {
  const output = Array.isArray(record(response).output) ? record(response).output as unknown[] : []
  return output.filter((item) => record(item).type === 'web_search_call').length
}

export function openAIUsageSnapshot(response: unknown, model: string, serviceTier = 'standard') {
  const root = record(response)
  const usage = record(root.usage)
  const inputDetails = record(usage.input_tokens_details)
  const outputDetails = record(usage.output_tokens_details)

  const inputTokens = number(usage.input_tokens)
  const cachedInputTokens = number(inputDetails.cached_tokens)
  const cacheWriteTokens = number(inputDetails.cache_write_tokens)
  const outputTokens = number(usage.output_tokens)
  const reasoningTokens = number(outputDetails.reasoning_tokens)
  const totalTokens = number(usage.total_tokens) || inputTokens + outputTokens
  const webSearchCalls = countWebSearchCalls(response)
  const resolvedTier = typeof root.service_tier === 'string' ? root.service_tier : serviceTier

  const base = STANDARD_PRICES[model]
  const tierMultiplier = resolvedTier === 'flex' || resolvedTier === 'batch' ? 0.5 : 1
  const price = base
    ? {
        input: base.input * tierMultiplier,
        cached: base.cached * tierMultiplier,
        cacheWrite: base.cacheWrite * tierMultiplier,
        output: base.output * tierMultiplier,
      }
    : null

  const regularInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens)
  const inputCost = price
    ? (regularInputTokens * price.input + cachedInputTokens * price.cached + cacheWriteTokens * price.cacheWrite) / 1_000_000
    : null
  const outputCost = price ? (outputTokens * price.output) / 1_000_000 : null
  const toolCost = webSearchCalls * 0.01
  const totalCost = inputCost == null || outputCost == null ? null : inputCost + outputCost + toolCost

  return {
    responseId: typeof root.id === 'string' ? root.id : null,
    serviceTier: resolvedTier,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    webSearchCalls,
    estimatedInputCostUsd: inputCost,
    estimatedOutputCostUsd: outputCost,
    estimatedToolCostUsd: toolCost,
    estimatedTotalCostUsd: totalCost,
    priceSnapshot: price
      ? {
          currency: 'USD',
          per_million_tokens: price,
          web_search_per_call: 0.01,
          pricing_basis: resolvedTier === 'flex' || resolvedTier === 'batch' ? '50% of standard token rates' : 'standard',
        }
      : { currency: 'USD', unpriced_model: model, web_search_per_call: 0.01 },
  }
}

export async function recordOpenAIUsage(
  supabase: SupabaseClient,
  response: unknown,
  context: UsageContext,
) {
  const snapshot = openAIUsageSnapshot(response, context.model, context.serviceTier || 'standard')

  const { error } = await supabase.from('ai_usage_events').insert({
    workspace_id: context.workspaceId,
    project_id: context.projectId,
    research_job_id: context.researchJobId || null,
    provider: 'openai',
    stage: context.stage,
    model: context.model,
    response_id: snapshot.responseId,
    service_tier: snapshot.serviceTier,
    input_tokens: snapshot.inputTokens,
    cached_input_tokens: snapshot.cachedInputTokens,
    cache_write_tokens: snapshot.cacheWriteTokens,
    output_tokens: snapshot.outputTokens,
    reasoning_tokens: snapshot.reasoningTokens,
    total_tokens: snapshot.totalTokens,
    web_search_calls: snapshot.webSearchCalls,
    estimated_input_cost_usd: snapshot.estimatedInputCostUsd,
    estimated_output_cost_usd: snapshot.estimatedOutputCostUsd,
    estimated_tool_cost_usd: snapshot.estimatedToolCostUsd,
    estimated_total_cost_usd: snapshot.estimatedTotalCostUsd,
    price_snapshot: snapshot.priceSnapshot,
    metadata: context.metadata || {},
  })

  if (error) {
    // Telemetry must never fail the user-facing research job.
    console.error('ai_usage_events insert failed', error.message)
  }

  return snapshot
}

export function openAIPromptCacheKey(projectId: string, stage: string) {
  return `riseklix:${projectId}:${stage}`.slice(0, 64)
}
