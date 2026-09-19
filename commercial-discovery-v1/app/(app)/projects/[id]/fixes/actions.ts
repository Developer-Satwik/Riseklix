'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const generateSchema = z.object({
  project_id: z.string().uuid(),
  finding_id: z.string().uuid(),
  regenerate: z.enum(['true', 'false']).optional(),
})

const blueprintSchema = z.object({
  project_id: z.string().uuid(),
  blueprint_id: z.string().uuid(),
})

const routeSchema = blueprintSchema.extend({
  route: z.enum(['diy', 'internal_team', 'expert', 'managed']),
})

const diyMethodSchema = blueprintSchema.extend({
  method: z.enum(['ai', 'manual']),
})

const diyToolSchema = blueprintSchema.extend({
  tool: z.enum(['lovable', 'claude_code', 'codex', 'other_ai']),
})

const taskStatusSchema = z.object({
  project_id: z.string().uuid(),
  blueprint_id: z.string().uuid(),
  task_id: z.string().uuid(),
  status: z.enum(['not_started', 'in_progress', 'ready_for_review', 'verified']),
  delivery_url: z.string().trim().url().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

async function edgeFunctionErrorMessage(error: unknown) {
  const candidate = error as { message?: string; context?: unknown } | null
  const fallback = candidate?.message || 'Blueprint generation failed'
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
  const { data, error } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (error || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

export async function generateBlueprint(formData: FormData) {
  const parsed = generateSchema.safeParse({
    project_id: formData.get('project_id'),
    finding_id: formData.get('finding_id'),
    regenerate: formData.get('regenerate') || undefined,
  })
  if (!parsed.success) redirect('/projects?error=Invalid+Blueprint+request')

  const { supabase } = await auth()
  const { data, error } = await supabase.functions.invoke('blueprint-generator', {
    body: {
      project_id: parsed.data.project_id,
      finding_id: parsed.data.finding_id,
      regenerate: parsed.data.regenerate === 'true',
    },
  })

  if (error) {
    const detail = await edgeFunctionErrorMessage(error)
    redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(detail)}`)
  }
  if (data?.error) {
    const message = data.error === 'reasoning_provider_not_configured'
      ? 'Blueprint Generator is deployed, but its reasoning-provider secret is not configured yet.'
      : String(data.message || data.error)
    redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(message)}`)
  }

  const message = data?.pending
    ? String(data.message || 'Blueprint generation started in the background.')
    : data?.reused
      ? 'Existing Blueprint reused.'
      : `Blueprint v${Number(data?.blueprint?.version ?? 1)} generated for review.`
  redirect(`/projects/${parsed.data.project_id}/fixes?message=${encodeURIComponent(message)}`)
}

export async function approveBlueprint(formData: FormData) {
  const parsed = blueprintSchema.safeParse({ project_id: formData.get('project_id'), blueprint_id: formData.get('blueprint_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+Blueprint+approval')

  const { supabase, userId } = await auth()
  const { data: blueprint, error: loadError } = await supabase
    .from('blueprints')
    .select('id,workspace_id,finding_id,status,version')
    .eq('id', parsed.data.blueprint_id)
    .eq('project_id', parsed.data.project_id)
    .single()
  if (loadError || !blueprint) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('Blueprint could not be loaded')}`)
  if (blueprint.status !== 'draft') redirect(`/projects/${parsed.data.project_id}/fixes?message=${encodeURIComponent(`Blueprint is already ${blueprint.status}`)}`)

  const { data: finding } = await supabase.from('findings').select('review_status,decision,is_current').eq('id', blueprint.finding_id).single()
  if (!finding || !finding.is_current || finding.review_status !== 'approved' || finding.decision !== 'fix') {
    redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('The supporting WHY finding must remain current, approved, and action-justified')}`)
  }

  const { error } = await supabase.from('blueprints').update({
    status: 'approved',
    approved_by: userId,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', blueprint.id)
  if (error) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_events').insert({
    workspace_id: blueprint.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: 'blueprint_approved',
    entity_type: 'blueprint',
    entity_id: blueprint.id,
    payload: { finding_id: blueprint.finding_id, version: blueprint.version },
  })

  redirect(`/projects/${parsed.data.project_id}/fixes?message=${encodeURIComponent('Blueprint approved · choose an execution path')}`)
}

export async function chooseExecutionRoute(formData: FormData) {
  const parsed = routeSchema.safeParse({
    project_id: formData.get('project_id'),
    blueprint_id: formData.get('blueprint_id'),
    route: formData.get('route'),
  })
  if (!parsed.success) redirect('/projects?error=Invalid+execution+route')

  const { supabase, userId } = await auth()
  const { data: blueprint, error: blueprintError } = await supabase
    .from('blueprints')
    .select('id,workspace_id,status,title')
    .eq('id', parsed.data.blueprint_id)
    .eq('project_id', parsed.data.project_id)
    .single()
  if (blueprintError || !blueprint) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('Blueprint could not be loaded')}`)
  if (!['approved', 'in_progress'].includes(blueprint.status)) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('Approve the Blueprint before routing execution')}`)

  const { data: existing } = await supabase
    .from('implementation_tasks')
    .select('id,status,route')
    .eq('blueprint_id', blueprint.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing && existing.status !== 'not_started' && existing.route !== parsed.data.route) {
    redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('Execution is already underway. Finish or review the active work order before changing routes.')}`)
  }

  if (existing) {
    const { error } = await supabase.from('implementation_tasks').update({ route: parsed.data.route, updated_at: new Date().toISOString() }).eq('id', existing.id)
    if (error) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(error.message)}`)
  } else {
    const { error } = await supabase.from('implementation_tasks').insert({
      workspace_id: blueprint.workspace_id,
      project_id: parsed.data.project_id,
      blueprint_id: blueprint.id,
      route: parsed.data.route,
      status: 'not_started',
      external_assignee: {},
      delivery_evidence: [],
      verification_result: {},
    })
    if (error) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(error.message)}`)
  }

  await supabase.from('audit_events').insert({
    workspace_id: blueprint.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: 'execution_route_selected',
    entity_type: 'blueprint',
    entity_id: blueprint.id,
    payload: { route: parsed.data.route, title: blueprint.title },
  })

  const routeLabel: Record<typeof parsed.data.route, string> = {
    diy: 'Do it myself',
    internal_team: 'Send to my team',
    expert: 'Hire a vetted specialist',
    managed: 'Let Riseklix handle it',
  }
  redirect(`/projects/${parsed.data.project_id}/fixes?message=${encodeURIComponent(`Execution path selected: ${routeLabel[parsed.data.route]}`)}`)
}


export async function chooseDiyMethod(formData: FormData) {
  const parsed = diyMethodSchema.safeParse({
    project_id: formData.get('project_id'),
    blueprint_id: formData.get('blueprint_id'),
    method: formData.get('method'),
  })
  if (!parsed.success) redirect('/projects?error=Invalid+DIY+execution+method')

  const { supabase, userId } = await auth()
  const { data: task, error: taskError } = await supabase
    .from('implementation_tasks')
    .select('id,workspace_id,route,status,external_assignee')
    .eq('project_id', parsed.data.project_id)
    .eq('blueprint_id', parsed.data.blueprint_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (taskError || !task) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('Choose Do it myself before selecting a DIY execution method')}`)
  if (task.route !== 'diy') redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('DIY execution options are only available when Do it myself is selected')}`)

  const current = task.external_assignee && typeof task.external_assignee === 'object' && !Array.isArray(task.external_assignee)
    ? task.external_assignee as Record<string, unknown>
    : {}

  const externalAssignee = {
    ...current,
    execution_method: parsed.data.method,
    ai_tool: parsed.data.method === 'ai' ? null : undefined,
    implementation_format: parsed.data.method === 'manual' ? 'developer_brief' : undefined,
    selected_at: new Date().toISOString(),
    selected_by: userId,
  }

  const { error } = await supabase.from('implementation_tasks').update({
    external_assignee: externalAssignee,
    updated_at: new Date().toISOString(),
  }).eq('id', task.id)

  if (error) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_events').insert({
    workspace_id: task.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: 'diy_execution_method_selected',
    entity_type: 'blueprint',
    entity_id: parsed.data.blueprint_id,
    payload: { method: parsed.data.method },
  })

  const message = parsed.data.method === 'ai'
    ? 'DIY with AI selected · choose the AI workspace you use.'
    : 'Manual DIY selected · the Blueprint is now your developer-ready implementation brief.'
  redirect(`/projects/${parsed.data.project_id}/fixes?message=${encodeURIComponent(message)}`)
}

export async function chooseDiyTool(formData: FormData) {
  const parsed = diyToolSchema.safeParse({
    project_id: formData.get('project_id'),
    blueprint_id: formData.get('blueprint_id'),
    tool: formData.get('tool'),
  })
  if (!parsed.success) redirect('/projects?error=Invalid+AI+workspace')

  const { supabase, userId } = await auth()
  const { data: task, error: taskError } = await supabase
    .from('implementation_tasks')
    .select('id,workspace_id,route,external_assignee')
    .eq('project_id', parsed.data.project_id)
    .eq('blueprint_id', parsed.data.blueprint_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (taskError || !task) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('DIY execution task could not be loaded')}`)
  if (task.route !== 'diy') redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('Choose Do it myself before selecting an AI workspace')}`)

  const current = task.external_assignee && typeof task.external_assignee === 'object' && !Array.isArray(task.external_assignee)
    ? task.external_assignee as Record<string, unknown>
    : {}

  if (current.execution_method !== 'ai') {
    redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent('Choose DIY with AI before selecting an AI workspace')}`)
  }

  const { error } = await supabase.from('implementation_tasks').update({
    external_assignee: {
      ...current,
      ai_tool: parsed.data.tool,
      tool_selected_at: new Date().toISOString(),
      tool_selected_by: userId,
    },
    updated_at: new Date().toISOString(),
  }).eq('id', task.id)

  if (error) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_events').insert({
    workspace_id: task.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: 'diy_ai_workspace_selected',
    entity_type: 'blueprint',
    entity_id: parsed.data.blueprint_id,
    payload: { tool: parsed.data.tool },
  })

  const labels: Record<typeof parsed.data.tool, string> = {
    lovable: 'Lovable',
    claude_code: 'Claude Code',
    codex: 'Codex',
    other_ai: 'Other AI workspace',
  }

  redirect(`/projects/${parsed.data.project_id}/fixes?message=${encodeURIComponent(`AI workspace selected: ${labels[parsed.data.tool]}`)}`)
}


export async function updateImplementationTask(formData: FormData) {
  const parsed = taskStatusSchema.safeParse({
    project_id: formData.get('project_id'),
    blueprint_id: formData.get('blueprint_id'),
    task_id: formData.get('task_id'),
    status: formData.get('status'),
    delivery_url: formData.get('delivery_url') || '',
    notes: formData.get('notes') || '',
  })
  if (!parsed.success) redirect('/projects?error=Invalid+delivery+update')

  const { supabase, userId } = await auth()
  const { data: task, error: taskError } = await supabase
    .from('implementation_tasks')
    .select('id,workspace_id,project_id,blueprint_id,route,status,delivery_evidence')
    .eq('id', parsed.data.task_id)
    .eq('project_id', parsed.data.project_id)
    .eq('blueprint_id', parsed.data.blueprint_id)
    .single()

  if (taskError || !task) {
    redirect('/projects/' + parsed.data.project_id + '/fixes?error=' + encodeURIComponent('Implementation task could not be loaded'))
  }

  const evidence = Array.isArray(task.delivery_evidence) ? [...task.delivery_evidence] : []
  if (parsed.data.delivery_url || parsed.data.notes) {
    evidence.push({
      url: parsed.data.delivery_url || null,
      notes: parsed.data.notes || null,
      submitted_at: new Date().toISOString(),
      submitted_by: userId,
    })
  }

  const verificationResult = parsed.data.status === 'verified'
    ? {
        status: 'verified',
        verified_at: new Date().toISOString(),
        verified_by: userId,
        method: 'manual_v1',
        note: 'Delivery verification only. This does not establish AI outcome impact.',
      }
    : {}

  const { error: updateError } = await supabase.from('implementation_tasks').update({
    status: parsed.data.status,
    delivery_evidence: evidence,
    verification_result: verificationResult,
    verified_by: parsed.data.status === 'verified' ? userId : null,
    verified_at: parsed.data.status === 'verified' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', task.id)

  if (updateError) {
    redirect('/projects/' + parsed.data.project_id + '/fixes?error=' + encodeURIComponent(updateError.message))
  }

  const blueprintStatus =
    parsed.data.status === 'verified' ? 'verified'
      : parsed.data.status === 'ready_for_review' ? 'implemented'
        : parsed.data.status === 'in_progress' ? 'in_progress'
          : 'approved'

  await supabase.from('blueprints').update({
    status: blueprintStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', parsed.data.blueprint_id)

  await supabase.from('audit_events').insert({
    workspace_id: task.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: 'implementation_status_changed',
    entity_type: 'blueprint',
    entity_id: parsed.data.blueprint_id,
    payload: {
      task_id: task.id,
      route: task.route,
      previous_status: task.status,
      status: parsed.data.status,
      delivery_url: parsed.data.delivery_url || null,
      delivery_note_supplied: Boolean(parsed.data.notes),
      impact_not_measured: true,
    },
  })

  const label = parsed.data.status.replaceAll('_', ' ')
  redirect('/projects/' + parsed.data.project_id + '/fixes?message=' + encodeURIComponent('Delivery status updated: ' + label))
}
