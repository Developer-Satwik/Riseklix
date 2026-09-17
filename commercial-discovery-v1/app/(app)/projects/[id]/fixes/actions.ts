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

  if (error) redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(error.message)}`)
  if (data?.error) {
    const message = data.error === 'reasoning_provider_not_configured'
      ? 'Blueprint Generator is deployed, but its reasoning-provider secret is not configured yet.'
      : String(data.message || data.error)
    redirect(`/projects/${parsed.data.project_id}/fixes?error=${encodeURIComponent(message)}`)
  }

  const message = data?.reused
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
