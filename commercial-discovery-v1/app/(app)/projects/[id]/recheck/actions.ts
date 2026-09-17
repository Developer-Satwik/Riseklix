'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({ project_id: z.string().uuid() })

export async function createBaselinePanel(formData: FormData) {
  const parsed = schema.safeParse({ project_id: formData.get('project_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+baseline+request')

  const supabase = await createClient()
  const { data: claims, error: claimsError } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (claimsError || typeof userId !== 'string') redirect('/login')

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,workspace_id,market,enabled_languages')
    .eq('id', parsed.data.project_id)
    .single()
  if (projectError || !project) redirect(`/projects/${parsed.data.project_id}/recheck?error=${encodeURIComponent('Project could not be loaded')}`)

  const { data: existingBaseline } = await supabase
    .from('benchmarks')
    .select('id')
    .eq('project_id', project.id)
    .eq('benchmark_type', 'baseline')
    .limit(1)
    .maybeSingle()
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
  if (!selected.length) {
    redirect(`/projects/${project.id}/recheck?error=${encodeURIComponent('Approve at least one unaided and one aided expression for the same Buyer Intent before creating a baseline')}`)
  }

  const languages = Array.from(new Set(selected.map((item) => item.language)))
  const { data: benchmark, error: benchmarkError } = await supabase
    .from('benchmarks')
    .insert({
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
        repetitions_per_expression: 3,
        session_policy: 'fresh_session_each_run',
        geography: project.market,
        providers: [],
        provider_policy: 'configure_before_run',
        notes: 'Baseline panel created from approved unaided + aided expressions. Observation providers are configured separately.',
      },
    })
    .select('id')
    .single()

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
    payload: { prompt_count: selected.length, intent_count: eligible.length, languages },
  })

  redirect(`/projects/${project.id}/recheck?message=${encodeURIComponent(`Baseline panel frozen with ${selected.length} approved expressions across ${eligible.length} Buyer Intents`)}`)
}
