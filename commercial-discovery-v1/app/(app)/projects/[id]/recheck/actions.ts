'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({ project_id: z.string().uuid() })
const runSchema = schema.extend({ benchmark_id: z.string().uuid() })
const recheckSchema = schema.extend({ baseline_id: z.string().uuid() })

async function auth() {
  const supabase = await createClient()
  const { data: claims, error: claimsError } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (claimsError || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

export async function createBaselinePanel(formData: FormData) {
  const parsed = schema.safeParse({ project_id: formData.get('project_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+baseline+request')

  const { supabase, userId } = await auth()
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,workspace_id,market,enabled_languages')
    .eq('id', parsed.data.project_id)
    .single()
  if (projectError || !project) redirect(`/projects/${parsed.data.project_id}/recheck?error=${encodeURIComponent('Project could not be loaded')}`)

  const { data: existingBaseline } = await supabase.from('benchmarks').select('id').eq('project_id', project.id).eq('benchmark_type', 'baseline').limit(1).maybeSingle()
  if (existingBaseline) redirect(`/projects/${project.id}/recheck?message=${encodeURIComponent('Baseline panel already exists')}`)

  const { data: expressions, error: expressionError } = await supabase
    .from('prompt_expressions')
    .select('id,buyer_intent_id,language,mode,variant_no,status,is_frozen')
    .eq('project_id', project.id)
    .eq('status', 'approved')
  if (expressionError) redirect(`/projects/${project.id}/recheck?error=${encodeURIComponent(expressionError.message)}`)

  const grouped = new Map<string, typeof expressions>()
  for (const expression of expressions ?? []) {
    const current = grouped.get(expression.buyer_intent_id) ?? []
    current.push(expression)
    grouped.set(expression.buyer_intent_id, current)
  }

  const eligible = Array.from(grouped.entries()).filter(([, items]) => {
    const modes = new Set(items.map((item) => item.mode))
    return modes.has('unaided') && modes.has('aided')
  })

  const selected = eligible.flatMap(([, items]) => items)
  if (!selected.length) redirect(`/projects/${project.id}/recheck?error=${encodeURIComponent('Approve at least one unaided and one aided expression for the same Buyer Intent before creating a baseline')}`)

  const languages = Array.from(new Set(selected.map((item) => item.language)))
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
      surface_policy: 'benchmark_complete_only_when_all_enabled_surfaces_complete',
      notes: 'Baseline panel created from approved unaided + aided expressions. Each observation surface is tracked independently.',
    },
  }).select('id').single()

  if (benchmarkError || !benchmark) redirect(`/projects/${project.id}/recheck?error=${encodeURIComponent(benchmarkError?.message ?? 'Could not create baseline')}`)

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
    redirect(`/projects/${project.id}/recheck?error=${encodeURIComponent(memberError.message)}`)
  }

  const { error: surfaceError } = await supabase.from('benchmark_surfaces').insert({
    workspace_id: project.workspace_id,
    project_id: project.id,
    benchmark_id: benchmark.id,
    provider: 'openai',
    surface: 'openai_responses_web_search',
    model_label: null,
    enabled: true,
    status: 'draft',
    expected_runs: selected.length * repetitions,
    captured_runs: 0,
    error_runs: 0,
    metadata: {
      display_name: 'OpenAI Responses API · free-plan proxy',
      methodology_note: 'Defaults to GPT-5.6 Luna with no reasoning and automatic web-search tool use to approximate a typical ChatGPT Free interaction. This remains an API surface, not the ChatGPT consumer application.',
      consumer_equivalence: 'approximate',
      model_resolved_at_run: true,
    },
  })

  if (surfaceError) {
    await supabase.from('benchmarks').delete().eq('id', benchmark.id)
    redirect(`/projects/${project.id}/recheck?error=${encodeURIComponent(surfaceError.message)}`)
  }

  const promptIds = selected.map((expression) => expression.id)
  const { error: freezeError } = await supabase.from('prompt_expressions').update({ is_frozen: true }).in('id', promptIds)
  if (freezeError) redirect(`/projects/${project.id}/recheck?error=${encodeURIComponent(freezeError.message)}`)

  await supabase.from('audit_events').insert({
    workspace_id: project.workspace_id,
    project_id: project.id,
    actor_user_id: userId,
    event_type: 'baseline_panel_created',
    entity_type: 'benchmark',
    entity_id: benchmark.id,
    payload: { prompt_count: selected.length, intent_count: eligible.length, languages, configured_surfaces: ['openai_responses_web_search'] },
  })

  await supabase.from('projects').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', project.id)

  redirect(`/projects/${project.id}/recheck?message=${encodeURIComponent(`Baseline panel frozen with ${selected.length} approved expressions across ${eligible.length} Buyer Intents`)}`)
}

export async function runOpenAIObservationBatch(formData: FormData) {
  const parsed = runSchema.safeParse({
    project_id: formData.get('project_id'),
    benchmark_id: formData.get('benchmark_id'),
  })
  if (!parsed.success) redirect('/projects?error=Invalid+observation+request')

  const { supabase } = await auth()
  const { data, error } = await supabase.functions.invoke('openai-observation-runner', {
    body: {
      project_id: parsed.data.project_id,
      benchmark_id: parsed.data.benchmark_id,
      max_runs: 4,
    },
  })

  if (error) redirect(`/projects/${parsed.data.project_id}/recheck?error=${encodeURIComponent(error.message)}`)
  if (data?.error) {
    const message = data.error === 'observation_provider_not_configured'
      ? 'The OpenAI observation runner is deployed, but OPENAI_API_KEY is not configured in Supabase Edge Function secrets.'
      : String(data.message || data.error)
    redirect(`/projects/${parsed.data.project_id}/recheck?error=${encodeURIComponent(message)}`)
  }

  const captured = Number(data?.captured ?? 0)
  const failed = Number(data?.failed ?? 0)
  const remaining = Number(data?.remaining ?? 0)
  const message = data?.surface_complete
    ? `OpenAI observation surface complete. ${Number(data?.total_captured ?? data?.captured ?? 0)} captures stored.${data?.benchmark_complete ? ' Benchmark complete.' : ''}`
    : `Observation batch stored: ${captured} captured, ${failed} failed, ${remaining} remaining on this surface.`

  if (data?.benchmark_complete) {
    await supabase.from('projects').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', parsed.data.project_id)
  }

  redirect(`/projects/${parsed.data.project_id}/recheck?message=${encodeURIComponent(message)}`)
}


export async function createPostChangeRecheck(formData: FormData) {
  const parsed = recheckSchema.safeParse({
    project_id: formData.get('project_id'),
    baseline_id: formData.get('baseline_id'),
  })
  if (!parsed.success) redirect('/projects?error=Invalid+recheck+request')

  const { supabase, userId } = await auth()

  const [{ data: project }, { data: baseline }, { data: verifiedTasks }] = await Promise.all([
    supabase.from('projects').select('id,workspace_id,market').eq('id', parsed.data.project_id).single(),
    supabase.from('benchmarks').select('id,status,version,collection_config').eq('id', parsed.data.baseline_id).eq('project_id', parsed.data.project_id).eq('benchmark_type', 'baseline').single(),
    supabase.from('implementation_tasks').select('id,blueprint_id,route,verified_at').eq('project_id', parsed.data.project_id).eq('status', 'verified'),
  ])

  if (!project || !baseline) {
    redirect('/projects/' + parsed.data.project_id + '/recheck?error=' + encodeURIComponent('Baseline or project could not be loaded'))
  }
  if (baseline.status !== 'complete') {
    redirect('/projects/' + parsed.data.project_id + '/recheck?error=' + encodeURIComponent('Complete the baseline before creating a post-change recheck'))
  }
  if (!verifiedTasks?.length) {
    redirect('/projects/' + parsed.data.project_id + '/recheck?error=' + encodeURIComponent('Verify at least one implementation before starting a post-change recheck'))
  }

  const { data: existingRechecks } = await supabase
    .from('benchmarks')
    .select('id,version,status')
    .eq('project_id', project.id)
    .eq('benchmark_type', 'recheck')
    .order('version', { ascending: false })

  const active = (existingRechecks ?? []).find((item) => ['draft', 'running'].includes(item.status))
  if (active) {
    redirect('/projects/' + project.id + '/recheck?message=' + encodeURIComponent('A post-change recheck is already active'))
  }

  const nextVersion = ((existingRechecks ?? [])[0]?.version ?? 0) + 1
  const [{ data: members }, { data: baselineSurfaces }] = await Promise.all([
    supabase.from('benchmark_prompts').select('buyer_intent_id,prompt_expression_id').eq('benchmark_id', baseline.id),
    supabase.from('benchmark_surfaces').select('provider,surface,model_label,enabled,expected_runs,metadata').eq('benchmark_id', baseline.id).eq('enabled', true),
  ])

  if (!members?.length || !baselineSurfaces?.length) {
    redirect('/projects/' + project.id + '/recheck?error=' + encodeURIComponent('The baseline does not contain a reusable prompt panel and observation surface'))
  }

  const baseConfig = baseline.collection_config && typeof baseline.collection_config === 'object' && !Array.isArray(baseline.collection_config)
    ? baseline.collection_config as Record<string, unknown>
    : {}

  const { data: recheck, error: createError } = await supabase.from('benchmarks').insert({
    workspace_id: project.workspace_id,
    project_id: project.id,
    created_by: userId,
    version: nextVersion,
    benchmark_type: 'recheck',
    status: 'draft',
    parent_benchmark_id: baseline.id,
    collection_config: {
      ...baseConfig,
      recheck_of: baseline.id,
      comparison_policy: 'frozen_prompt_panel',
      verified_implementation_ids: verifiedTasks.map((task) => task.id),
      verified_blueprint_ids: verifiedTasks.map((task) => task.blueprint_id),
      verified_implementation_snapshot: verifiedTasks.map((task) => ({
        task_id: task.id,
        blueprint_id: task.blueprint_id,
        route: task.route,
        verified_at: task.verified_at,
      })),
      created_for_post_change_measurement: true,
    },
  }).select('id').single()

  if (createError || !recheck) {
    redirect('/projects/' + project.id + '/recheck?error=' + encodeURIComponent(createError?.message ?? 'Could not create recheck'))
  }

  const promptRows = members.map((member) => ({
    benchmark_id: recheck.id,
    workspace_id: project.workspace_id,
    project_id: project.id,
    buyer_intent_id: member.buyer_intent_id,
    prompt_expression_id: member.prompt_expression_id,
  }))

  const { error: promptError } = await supabase.from('benchmark_prompts').insert(promptRows)
  if (promptError) {
    await supabase.from('benchmarks').delete().eq('id', recheck.id)
    redirect('/projects/' + project.id + '/recheck?error=' + encodeURIComponent(promptError.message))
  }

  const surfaceRows = baselineSurfaces.map((surface) => ({
    workspace_id: project.workspace_id,
    project_id: project.id,
    benchmark_id: recheck.id,
    provider: surface.provider,
    surface: surface.surface,
    model_label: surface.model_label,
    enabled: true,
    status: 'draft',
    expected_runs: surface.expected_runs,
    captured_runs: 0,
    error_runs: 0,
    metadata: {
      ...(surface.metadata && typeof surface.metadata === 'object' && !Array.isArray(surface.metadata) ? surface.metadata as Record<string, unknown> : {}),
      copied_from_baseline_surface: true,
    },
  }))

  const { error: surfaceError } = await supabase.from('benchmark_surfaces').insert(surfaceRows)
  if (surfaceError) {
    await supabase.from('benchmarks').delete().eq('id', recheck.id)
    redirect('/projects/' + project.id + '/recheck?error=' + encodeURIComponent(surfaceError.message))
  }

  await Promise.all([
    supabase.from('projects').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', project.id),
    supabase.from('audit_events').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      actor_user_id: userId,
      event_type: 'post_change_recheck_created',
      entity_type: 'benchmark',
      entity_id: recheck.id,
      payload: {
        parent_baseline_id: baseline.id,
        version: nextVersion,
        verified_task_ids: verifiedTasks.map((task) => task.id),
        prompt_count: promptRows.length,
        surface_count: surfaceRows.length,
      },
    }),
  ])

  redirect('/projects/' + project.id + '/recheck?message=' + encodeURIComponent('Post-change recheck v' + nextVersion + ' created from the frozen baseline panel'))
}
