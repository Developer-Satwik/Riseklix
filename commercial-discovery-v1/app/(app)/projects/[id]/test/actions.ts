'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isUnaidedRetrievalEligible } from '@/lib/prompt-eligibility'

const schema = z.object({ project_id: z.string().uuid() })

async function edgeFunctionErrorMessage(error: unknown) {
  const candidate = error as { message?: string; context?: unknown } | null
  const fallback = candidate?.message || 'Could not start AI tests'
  const context = candidate?.context

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string; message?: string }
      return payload?.message || payload?.error || fallback
    } catch {
      try {
        const body = await context.clone().text()
        return body || fallback
      } catch {
        return fallback
      }
    }
  }
  return fallback
}

async function auth() {
  const supabase = await createClient()
  const { data: claims, error: claimsError } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (claimsError || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

async function ensureBaseline(projectId: string) {
  const { supabase, userId } = await auth()

  const { data: existingBaseline } = await supabase
    .from('benchmarks')
    .select('id,status')
    .eq('project_id', projectId)
    .eq('benchmark_type', 'baseline')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingBaseline) return { supabase, benchmarkId: existingBaseline.id }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,workspace_id,market')
    .eq('id', projectId)
    .single()

  if (projectError || !project) {
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent('Project could not be loaded'))
  }

  const { data: expressions, error: expressionError } = await supabase
    .from('prompt_expressions')
    .select('id,buyer_intent_id,language,mode,status,prompt_text')
    .eq('project_id', projectId)
    .eq('status', 'approved')

  if (expressionError) {
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent(expressionError.message))
  }

  const admissibleExpressions = (expressions ?? []).filter((expression) =>
    expression.mode !== 'unaided' || isUnaidedRetrievalEligible(expression.prompt_text)
  )
  const excludedUnaided = (expressions ?? []).filter((expression) =>
    expression.mode === 'unaided' && !isUnaidedRetrievalEligible(expression.prompt_text)
  )

  const grouped = new Map<string, typeof admissibleExpressions>()
  for (const expression of admissibleExpressions) {
    const items = grouped.get(expression.buyer_intent_id) ?? []
    items.push(expression)
    grouped.set(expression.buyer_intent_id, items)
  }

  const eligible = Array.from(grouped.entries()).filter(([, items]) => {
    const modes = new Set(items.map((item) => item.mode))
    return modes.has('unaided') && modes.has('aided')
  })
  const selected = eligible.flatMap(([, items]) => items)

  if (!selected.length) {
    redirect('/projects/' + projectId + '/buyer-situations?error=' + encodeURIComponent('Approve at least one buyer question and one brand check under the same Buyer Situation before running tests'))
  }

  const { data: providerPreflight, error: providerPreflightError } = await supabase.functions.invoke('observation-provider-preflight', {
    body: { project_id: projectId },
  })
  if (providerPreflightError) {
    const detail = await edgeFunctionErrorMessage(providerPreflightError)
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent('Could not verify AI-system readiness: ' + detail))
  }

  const configuredProviders = new Set<string>(
    Array.isArray(providerPreflight?.configured_providers)
      ? providerPreflight.configured_providers.map((provider: unknown) => String(provider))
      : [],
  )
  const minimumProviders = Number(providerPreflight?.minimum_required || 3)
  if (!providerPreflight?.ready || configuredProviders.size < minimumProviders) {
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent(
      `Riseklix needs at least ${minimumProviders} configured AI systems before creating a cross-model baseline. ${configuredProviders.size} ${configuredProviders.size === 1 ? 'is' : 'are'} configured right now.`,
    ))
  }

  const languages = Array.from(new Set(selected.map((item) => item.language))
  )
  const repetitions = 3

  const { data: benchmark, error: benchmarkError } = await supabase.from('benchmarks').insert({
    workspace_id: project.workspace_id,
    project_id: project.id,
    created_by: userId,
    version: 1,
    benchmark_type: 'baseline',
    status: 'draft',
    collection_config: {
      panel_locked: true,
      prompt_count: selected.length,
      intent_count: eligible.length,
      languages,
      repetitions_per_expression: repetitions,
      session_policy: 'fresh_session_each_run',
      geography: project.market,
      surface_policy: 'minimum_three_usable_providers; failed providers excluded from aggregate interpretation',
      notes: 'Baseline created automatically when the user runs approved buyer questions. Criteria-only unaided questions are excluded from retrieval denominators.',
      retrieval_eligibility_policy: 'unaided prompts must ask for identifiable commercial options',
      excluded_unaided_prompt_count: excludedUnaided.length,
      configured_providers_at_start: Array.from(configuredProviders),
    },
  }).select('id').single()

  if (benchmarkError || !benchmark) {
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent(benchmarkError?.message ?? 'Could not create baseline'))
  }

  const members = selected.map((expression) => ({
    benchmark_id: benchmark.id,
    workspace_id: project.workspace_id,
    project_id: project.id,
    buyer_intent_id: expression.buyer_intent_id,
    prompt_expression_id: expression.id,
  }))

  const { error: memberError } = await supabase.from('benchmark_prompts').insert(members)
  if (memberError) {
    await supabase.from('benchmarks').delete().eq('id', benchmark.id)
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent(memberError.message))
  }

  const expectedRuns = selected.length * repetitions
  const surfaceRows = [
    {
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmark.id,
      provider: 'openai',
      surface: 'openai_responses_web_search',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'OpenAI · free-plan proxy',
        methodology_note: 'API observation proxy using a low-cost OpenAI model with web search. It is not represented as the ChatGPT consumer UI.',
        consumer_equivalence: 'approximate',
      },
    },
    {
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmark.id,
      provider: 'google',
      surface: 'gemini_generate_content_google_search',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'Gemini · Flash API proxy',
        methodology_note: 'Gemini API with Google Search grounding. This is an API observation proxy, not the Gemini consumer application.',
        consumer_equivalence: 'approximate',
      },
    },
    {
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmark.id,
      provider: 'anthropic',
      surface: 'anthropic_messages_firecrawl_grounded',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'Claude · Haiku + Firecrawl',
        methodology_note: 'Claude Haiku 4.5 receives compact Firecrawl search evidence. This is not Claude consumer search or Anthropic native web search.',
        consumer_equivalence: 'approximate',
      },
    },
    {
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmark.id,
      provider: 'perplexity',
      surface: 'perplexity_sonar',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'Perplexity · Sonar API',
        methodology_note: 'Perplexity Sonar web-grounded API surface. Kept separate from the consumer Standard plan.',
        consumer_equivalence: 'approximate',
      },
    },
  ].filter((surface) => configuredProviders.has(surface.provider))

  const { error: surfaceError } = await supabase.from('benchmark_surfaces').insert(surfaceRows)
  if (surfaceError) {
    await supabase.from('benchmarks').delete().eq('id', benchmark.id)
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent(surfaceError.message))
  }

  const promptIds = selected.map((expression) => expression.id)
  const { error: freezeError } = await supabase.from('prompt_expressions').update({ is_frozen: true }).in('id', promptIds)
  if (freezeError) {
    redirect('/projects/' + projectId + '/test?error=' + encodeURIComponent(freezeError.message))
  }

  await Promise.all([
    supabase.from('audit_events').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      actor_user_id: userId,
      event_type: 'baseline_panel_created',
      entity_type: 'benchmark',
      entity_id: benchmark.id,
      payload: {
        prompt_count: selected.length,
        intent_count: eligible.length,
        languages,
        configured_surfaces: surfaceRows.map((surface) => surface.surface),
        started_from: 'run_approved_questions',
        excluded_unaided_prompt_count: excludedUnaided.length,
      },
    }),
    supabase.from('projects').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', project.id),
  ])

  return { supabase, benchmarkId: benchmark.id }
}

export async function runApprovedQuestions(formData: FormData) {
  const parsed = schema.safeParse({ project_id: formData.get('project_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+test+request')

  const { supabase, benchmarkId } = await ensureBaseline(parsed.data.project_id)

  const { data, error } = await supabase.functions.invoke('all-observation-runner', {
    body: {
      project_id: parsed.data.project_id,
      benchmark_id: benchmarkId,
    },
  })

  if (error) {
    const detail = await edgeFunctionErrorMessage(error)
    redirect('/projects/' + parsed.data.project_id + '/test?error=' + encodeURIComponent(detail))
  }

  if (data?.error) {
    redirect('/projects/' + parsed.data.project_id + '/test?error=' + encodeURIComponent(String(data.message || data.error)))
  }

  const message = data?.complete
    ? 'All enabled AI surfaces are already complete.'
    : data?.pending
      ? String(data.message || 'Approved questions are running across the configured AI surfaces.')
      : 'Approved-question testing started.'

  redirect('/projects/' + parsed.data.project_id + '/test?message=' + encodeURIComponent(message))
}
