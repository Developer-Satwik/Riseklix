'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const projectSchema = z.object({
  domain: z.string().min(3),
  market: z.string().min(2),
  industry: z.string().optional(),
  analysis_mode: z.enum(['manual','autopilot']),
  primary_language: z.enum(['English', 'Hindi', 'Hinglish']),
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
    analysis_mode: formData.get('analysis_mode') || 'autopilot',
    primary_language: formData.get('primary_language') || 'English',
  })

  if (!parsed.success) redirect('/projects/new?error=Check+the+company+website+and+market')

  const supabase = await createClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub

  if (claimsError || typeof userId !== 'string') redirect('/login')

  const domain = normalizeDomain(parsed.data.domain)
  const companyName = nameFromDomain(domain)

  const { data: projectId, error } = await supabase.rpc('bootstrap_project', {
    p_company_name: companyName,
    p_domain: domain,
    p_market: parsed.data.market,
    p_industry: parsed.data.industry || null,
  })

  if (error || typeof projectId !== 'string') {
    const message = error?.message ?? 'Could not create project'
    redirect('/projects/new?error=' + encodeURIComponent(message))
  }

  const { error: modeError } = await supabase
    .from('projects')
    .update({
      analysis_mode: parsed.data.analysis_mode,
      primary_language: parsed.data.primary_language,
      enabled_languages: [parsed.data.primary_language],
    })
    .eq('id', projectId)

  if (modeError) {
    redirect('/projects/' + projectId + '/company-profile?error=' + encodeURIComponent(modeError.message))
  }

  if (parsed.data.analysis_mode === 'autopilot') {
    const research = await supabase.functions.invoke('company-research', {
      body: { project_id: projectId, regenerate: false },
    })

    if (!research.error && !research.data?.error) {
      await supabase.functions.invoke('company-intelligence-interpreter', {
        body: { project_id: projectId },
      })
    }
  }

  redirect('/projects/' + projectId + '/company-profile')
}
