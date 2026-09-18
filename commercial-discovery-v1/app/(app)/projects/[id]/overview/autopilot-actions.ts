'use server'

import { createClient } from '@/lib/supabase/server'

export async function resumeAutopilot(projectId: string) {
  const supabase = await createClient()
  const { data: claims, error: authError } = await supabase.auth.getClaims()
  if (authError || !claims?.claims?.sub) return { ok: false, message: 'Authentication required' }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,analysis_mode,status')
    .eq('id', projectId)
    .single()

  if (projectError || !project) return { ok: false, message: 'Project could not be loaded' }
  if (project.analysis_mode !== 'autopilot' || project.status === 'complete') return { ok: true, skipped: true }

  const { data: profile } = await supabase
    .from('company_profile_versions')
    .select('status')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle()

  if (profile?.status !== 'approved') return { ok: true, skipped: true }

  const { data, error } = await supabase.functions.invoke('auto-analysis-runner', {
    body: { project_id: projectId },
  })

  if (!error && !data?.error) {
    return { ok: true, stage: String(data?.stage || 'running'), pending: Boolean(data?.pending) }
  }

  // Resilient first-stage fallback. Once intent generation finishes, its callback
  // hands control back to auto-analysis-runner.
  const fallback = await supabase.functions.invoke('intent-suggestor', {
    body: { project_id: projectId },
  })

  if (fallback.error || fallback.data?.error) {
    return {
      ok: false,
      message: String(fallback.data?.message || fallback.data?.error || fallback.error?.message || error?.message || 'AI Autopilot could not resume'),
    }
  }

  return { ok: true, stage: 'generating_buyer_situations', pending: true }
}
