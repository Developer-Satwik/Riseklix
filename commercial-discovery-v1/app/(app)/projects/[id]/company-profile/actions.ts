'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const projectSchema = z.object({ project_id: z.string().uuid() })
const profileSchema = projectSchema.extend({
  company_name: z.string().trim().min(2).max(180),
  industry: z.string().trim().max(240).optional(),
  business_model: z.string().trim().max(400).optional(),
  summary: z.string().trim().min(20).max(5000),
  products: z.string().max(8000).optional(),
  services: z.string().max(8000).optional(),
  audiences: z.string().max(8000).optional(),
  geographies: z.string().max(8000).optional(),
  uncertainty: z.string().max(8000).optional(),
})

function lines(value?: string) {
  return (value ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100)
}

async function authenticatedClient() {
  const supabase = await createClient()
  const { data: claims, error } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (error || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

export async function runCompanyResearch(formData: FormData) {
  const parsed = projectSchema.safeParse({ project_id: formData.get('project_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+project')

  const { supabase } = await authenticatedClient()
  const { data, error } = await supabase.functions.invoke('company-research', {
    body: { project_id: parsed.data.project_id },
  })

  if (error) redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent(error.message)}`)
  if (data?.error) redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent(String(data.error))}`)

  const reused = data?.reused ? 'Existing research capture reused' : 'First-party evidence captured'
  redirect(`/projects/${parsed.data.project_id}/company-profile?message=${encodeURIComponent(reused)}`)
}

export async function saveCompanyProfile(formData: FormData) {
  const parsed = profileSchema.safeParse({
    project_id: formData.get('project_id'),
    company_name: formData.get('company_name'),
    industry: formData.get('industry') || undefined,
    business_model: formData.get('business_model') || undefined,
    summary: formData.get('summary'),
    products: formData.get('products') || undefined,
    services: formData.get('services') || undefined,
    audiences: formData.get('audiences') || undefined,
    geographies: formData.get('geographies') || undefined,
    uncertainty: formData.get('uncertainty') || undefined,
  })

  if (!parsed.success) {
    redirect(`/projects/${String(formData.get('project_id') ?? '')}/company-profile?error=${encodeURIComponent('Check the company profile fields before saving')}`)
  }

  const { supabase, userId } = await authenticatedClient()
  const { data: profile, error: profileError } = await supabase
    .from('company_profile_versions')
    .select('id,workspace_id,status')
    .eq('project_id', parsed.data.project_id)
    .eq('is_current', true)
    .single()

  if (profileError || !profile) redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent('Current company profile could not be loaded')}`)

  const { error } = await supabase
    .from('company_profile_versions')
    .update({
      company_name: parsed.data.company_name,
      industry: parsed.data.industry || null,
      business_model: parsed.data.business_model || null,
      summary: parsed.data.summary,
      products: lines(parsed.data.products),
      services: lines(parsed.data.services),
      audiences: lines(parsed.data.audiences),
      geographies: lines(parsed.data.geographies),
      uncertainty: lines(parsed.data.uncertainty),
      status: profile.status === 'approved' ? 'draft' : profile.status,
      approved_by: null,
      approved_at: null,
    })
    .eq('id', profile.id)

  if (error) redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent(error.message)}`)

  await Promise.all([
    supabase.from('projects').update({ name: parsed.data.company_name, status: 'profile_review' }).eq('id', parsed.data.project_id),
    supabase.from('audit_events').insert({
      workspace_id: profile.workspace_id,
      project_id: parsed.data.project_id,
      actor_user_id: userId,
      event_type: 'company_profile_saved',
      entity_type: 'company_profile',
      entity_id: profile.id,
      payload: { source: 'user_review' },
    }),
  ])

  redirect(`/projects/${parsed.data.project_id}/company-profile?message=${encodeURIComponent('Company profile saved for review')}`)
}

export async function approveCompanyProfile(formData: FormData) {
  const parsed = projectSchema.safeParse({ project_id: formData.get('project_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+project')

  const { supabase, userId } = await authenticatedClient()
  const { data: profile, error: profileError } = await supabase
    .from('company_profile_versions')
    .select('id,workspace_id,company_name,summary')
    .eq('project_id', parsed.data.project_id)
    .eq('is_current', true)
    .single()

  if (profileError || !profile) redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent('Current company profile could not be loaded')}`)
  if (!profile.summary || profile.summary.trim().length < 20) redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent('Complete the company summary before approval')}`)

  const approvedAt = new Date().toISOString()
  const { error } = await supabase
    .from('company_profile_versions')
    .update({ status: 'approved', approved_by: userId, approved_at: approvedAt })
    .eq('id', profile.id)

  if (error) redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent(error.message)}`)

  await Promise.all([
    supabase.from('projects').update({ name: profile.company_name, status: 'intents_review' }).eq('id', parsed.data.project_id),
    supabase.from('audit_events').insert({
      workspace_id: profile.workspace_id,
      project_id: parsed.data.project_id,
      actor_user_id: userId,
      event_type: 'company_profile_approved',
      entity_type: 'company_profile',
      entity_id: profile.id,
      payload: { approved_at: approvedAt },
    }),
  ])

  redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent('Company profile approved. Buyer Intent generation is now unlocked.')}`)
}
