'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const projectSchema = z.object({
  domain: z.string().min(3),
  market: z.string().min(2),
  industry: z.string().optional(),
})

function normalizeDomain(input: string) {
  return input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

function nameFromDomain(domain: string) {
  const root = domain.split('.')[0] || domain
  return root.split(/[-_]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export async function createProject(formData: FormData) {
  const parsed = projectSchema.safeParse({
    domain: formData.get('domain'),
    market: formData.get('market'),
    industry: formData.get('industry') || undefined,
  })
  if (!parsed.success) redirect('/projects/new?error=Check+the+company+website+and+market')

  const supabase = await createClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub
  if (claimsError || typeof userId !== 'string') redirect('/login')

  const existingWorkspace = await supabase.from('workspaces').select('id').limit(1).maybeSingle()
  let workspaceId = existingWorkspace.data?.id

  if (!workspaceId) {
    const slug = `workspace-${crypto.randomUUID().slice(0, 8)}`
    const createdWorkspace = await supabase
      .from('workspaces')
      .insert({ name: 'My Workspace', slug, created_by: userId })
      .select('id')
      .single()

    if (createdWorkspace.error || !createdWorkspace.data) {
      redirect(`/projects/new?error=${encodeURIComponent(createdWorkspace.error?.message ?? 'Could not create workspace')}`)
    }

    workspaceId = createdWorkspace.data.id
    const member = await supabase.from('workspace_members').insert({ workspace_id: workspaceId, user_id: userId, role: 'owner' })
    if (member.error) redirect(`/projects/new?error=${encodeURIComponent(member.error.message)}`)
  }

  const domain = normalizeDomain(parsed.data.domain)
  const companyName = nameFromDomain(domain)
  const created = await supabase.from('projects').insert({
    workspace_id: workspaceId,
    created_by: userId,
    name: companyName,
    domain,
    market: parsed.data.market,
    status: 'draft',
  }).select('id').single()

  if (created.error || !created.data) {
    redirect(`/projects/new?error=${encodeURIComponent(created.error?.message ?? 'Could not create project')}`)
  }

  const profile = await supabase.from('company_profile_versions').insert({
    workspace_id: workspaceId,
    project_id: created.data.id,
    version: 1,
    is_current: true,
    status: 'draft',
    company_name: companyName,
    industry: parsed.data.industry || null,
    summary: 'Company intelligence research has not been run yet.',
  })

  if (profile.error) redirect(`/projects/${created.data.id}/company-profile?error=${encodeURIComponent(profile.error.message)}`)
  redirect(`/projects/${created.data.id}/company-profile`)
}
