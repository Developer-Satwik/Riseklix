'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const runSchema = z.object({
  project_id: z.string().uuid(),
  benchmark_id: z.string().uuid(),
  regenerate: z.enum(['true', 'false']).optional(),
})

const reviewSchema = z.object({
  project_id: z.string().uuid(),
  finding_id: z.string().uuid(),
})

async function auth() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (error || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

export async function runWhyEvaluation(formData: FormData) {
  const parsed = runSchema.safeParse({
    project_id: formData.get('project_id'),
    benchmark_id: formData.get('benchmark_id'),
    regenerate: formData.get('regenerate') || undefined,
  })
  if (!parsed.success) redirect('/projects?error=Invalid+WHY+evaluation+request')

  const { supabase } = await auth()
  const { data, error } = await supabase.functions.invoke('why-evaluator', {
    body: {
      project_id: parsed.data.project_id,
      benchmark_id: parsed.data.benchmark_id,
      max_intents: 4,
      regenerate: parsed.data.regenerate === 'true',
    },
  })

  if (error) redirect(`/projects/${parsed.data.project_id}/why?error=${encodeURIComponent(error.message)}`)
  if (data?.error) {
    const message = data.error === 'reasoning_provider_not_configured'
      ? 'WHY Evaluator is deployed, but its reasoning-provider secret is not configured yet.'
      : String(data.message || data.error)
    redirect(`/projects/${parsed.data.project_id}/why?error=${encodeURIComponent(message)}`)
  }

  const generated = Number(data?.generated ?? 0)
  const current = Number(data?.current_findings ?? 0)
  const total = Number(data?.intents_with_captures ?? 0)
  const message = data?.complete
    ? `WHY evaluation is current for ${total} captured Buyer Intent${total === 1 ? '' : 's'}.`
    : `${generated} WHY finding${generated === 1 ? '' : 's'} generated in this batch · ${current}/${total} current.`

  redirect(`/projects/${parsed.data.project_id}/why?message=${encodeURIComponent(message)}`)
}

async function setFindingStatus(formData: FormData, reviewStatus: 'approved' | 'rejected') {
  const parsed = reviewSchema.safeParse({
    project_id: formData.get('project_id'),
    finding_id: formData.get('finding_id'),
  })
  if (!parsed.success) redirect('/projects?error=Invalid+WHY+review+request')

  const { supabase, userId } = await auth()
  const { data: finding, error: findingError } = await supabase
    .from('findings')
    .select('id,workspace_id,buyer_intent_id,decision,review_status,is_current')
    .eq('id', parsed.data.finding_id)
    .eq('project_id', parsed.data.project_id)
    .single()

  if (findingError || !finding || !finding.is_current) redirect(`/projects/${parsed.data.project_id}/why?error=${encodeURIComponent('Current WHY finding could not be loaded')}`)

  const { error } = await supabase.from('findings').update({
    review_status: reviewStatus,
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
    review_source: 'manual',
  }).eq('id', finding.id)
  if (error) redirect(`/projects/${parsed.data.project_id}/why?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_events').insert({
    workspace_id: finding.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: `why_finding_${reviewStatus}`,
    entity_type: 'finding',
    entity_id: finding.id,
    payload: { buyer_intent_id: finding.buyer_intent_id, decision: finding.decision },
  })

  redirect(`/projects/${parsed.data.project_id}/why?message=${encodeURIComponent(`WHY finding ${reviewStatus}`)}`)
}

export async function approveFinding(formData: FormData) {
  return setFindingStatus(formData, 'approved')
}

export async function rejectFinding(formData: FormData) {
  return setFindingStatus(formData, 'rejected')
}
