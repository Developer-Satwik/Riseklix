'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const projectSchema = z.object({ project_id: z.string().uuid() })
const intentIdSchema = projectSchema.extend({ intent_id: z.string().uuid() })
const candidateSchema = projectSchema.extend({
  title: z.string().trim().min(3).max(220),
  buyer: z.string().trim().min(2).max(300),
  job_to_be_done: z.string().trim().min(10).max(3000),
  commercial_model: z.string().trim().max(220).optional(),
  geography: z.string().trim().max(500).optional(),
  provenance: z.enum(['observed', 'adapted', 'exploratory']),
  provenance_reason: z.string().trim().min(5).max(2000),
  priority: z.enum(['critical', 'high', 'medium', 'monitor']),
  constraints: z.string().max(5000).optional(),
  required_capabilities: z.string().max(5000).optional(),
})

function lines(value?: string) {
  return (value ?? '').split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 100)
}

async function auth() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (error || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

export async function addIntentCandidate(formData: FormData) {
  const parsed = candidateSchema.safeParse({
    project_id: formData.get('project_id'),
    title: formData.get('title'),
    buyer: formData.get('buyer'),
    job_to_be_done: formData.get('job_to_be_done'),
    commercial_model: formData.get('commercial_model') || undefined,
    geography: formData.get('geography') || undefined,
    provenance: formData.get('provenance'),
    provenance_reason: formData.get('provenance_reason'),
    priority: formData.get('priority'),
    constraints: formData.get('constraints') || undefined,
    required_capabilities: formData.get('required_capabilities') || undefined,
  })

  if (!parsed.success) redirect(`/projects/${String(formData.get('project_id') ?? '')}/buyer-situations?error=${encodeURIComponent('Check the Buyer Intent fields')}`)

  const { supabase, userId } = await auth()
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('workspace_id,status')
    .eq('id', parsed.data.project_id)
    .single()

  const { data: profile, error: profileError } = await supabase
    .from('company_profile_versions')
    .select('id,status')
    .eq('project_id', parsed.data.project_id)
    .eq('is_current', true)
    .single()

  if (projectError || profileError || !project || !profile) redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent('Project context could not be loaded')}`)
  if (profile.status !== 'approved') redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent('Approve the Company Intelligence Profile before creating Buyer Intents')}`)

  const count = await supabase.from('buyer_intents').select('id', { count: 'exact', head: true }).eq('project_id', parsed.data.project_id)
  const nextNo = (count.count ?? 0) + 1
  const intentKey = `INT-${String(nextNo).padStart(3, '0')}`

  const { data: intent, error } = await supabase.from('buyer_intents').insert({
    workspace_id: project.workspace_id,
    project_id: parsed.data.project_id,
    profile_version_id: profile.id,
    intent_key: intentKey,
    version: 1,
    status: 'candidate',
    title: parsed.data.title,
    buyer: parsed.data.buyer,
    job_to_be_done: parsed.data.job_to_be_done,
    constraints: lines(parsed.data.constraints),
    required_capabilities: lines(parsed.data.required_capabilities),
    geography: parsed.data.geography ? { primary: parsed.data.geography } : {},
    commercial_model: parsed.data.commercial_model || null,
    provenance: parsed.data.provenance,
    provenance_reason: parsed.data.provenance_reason,
    priority: parsed.data.priority,
  }).select('id').single()

  if (error || !intent) redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(error?.message ?? 'Could not create intent')}`)

  await supabase.from('audit_events').insert({
    workspace_id: project.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: 'buyer_intent_created',
    entity_type: 'buyer_intent',
    entity_id: intent.id,
    payload: { intent_key: intentKey, provenance: parsed.data.provenance, creation_mode: 'manual_qa' },
  })

  redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(`${intentKey} added as a candidate`)}`)
}

async function setIntentStatus(formData: FormData, status: 'approved' | 'rejected') {
  const parsed = intentIdSchema.safeParse({ project_id: formData.get('project_id'), intent_id: formData.get('intent_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+Buyer+Intent')

  const { supabase, userId } = await auth()
  const { data: intent, error: loadError } = await supabase
    .from('buyer_intents')
    .select('id,workspace_id,intent_key')
    .eq('id', parsed.data.intent_id)
    .eq('project_id', parsed.data.project_id)
    .single()

  if (loadError || !intent) redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent('Buyer Intent could not be loaded')}`)

  const approvedAt = status === 'approved' ? new Date().toISOString() : null
  const { error } = await supabase.from('buyer_intents').update({
    status,
    approved_by: status === 'approved' ? userId : null,
    approved_at: approvedAt,
  }).eq('id', intent.id)

  if (error) redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_events').insert({
    workspace_id: intent.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: `buyer_intent_${status}`,
    entity_type: 'buyer_intent',
    entity_id: intent.id,
    payload: { intent_key: intent.intent_key },
  })

  redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(`${intent.intent_key} ${status}`)}`)
}

export async function approveIntent(formData: FormData) {
  return setIntentStatus(formData, 'approved')
}

export async function rejectIntent(formData: FormData) {
  return setIntentStatus(formData, 'rejected')
}
