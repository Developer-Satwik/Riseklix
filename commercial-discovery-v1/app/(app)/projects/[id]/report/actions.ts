'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  project_id: z.string().uuid(),
  scope: z.enum(['critical', 'high', 'all']),
})

const ranks: Record<string, number> = {
  urgent: 0,
  opportunity: 1,
  monitor: 2,
  healthy: 3,
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

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

export async function generatePriorityFixes(formData: FormData) {
  const parsed = schema.safeParse({
    project_id: formData.get('project_id'),
    scope: formData.get('scope'),
  })

  if (!parsed.success) redirect('/projects?error=Invalid+fix+generation+request')

  const supabase = await createClient()
  const { data: claims, error: authError } = await supabase.auth.getClaims()
  if (authError || !claims?.claims?.sub) redirect('/login')

  const [{ data: findings }, { data: existingBlueprints }] = await Promise.all([
    supabase
      .from('findings')
      .select('id,severity,decision,review_status,is_current')
      .eq('project_id', parsed.data.project_id)
      .eq('is_current', true)
      .eq('review_status', 'approved')
      .eq('decision', 'fix'),
    supabase
      .from('blueprints')
      .select('finding_id')
      .eq('project_id', parsed.data.project_id),
  ])

  const existing = new Set((existingBlueprints ?? []).map((item) => item.finding_id))
  const maxRank = parsed.data.scope === 'critical' ? 0 : parsed.data.scope === 'high' ? 1 : 3

  const selected = (findings ?? [])
    .filter((finding) => (ranks[finding.severity] ?? 3) <= maxRank)
    .filter((finding) => !existing.has(finding.id))
    .sort((a, b) => (ranks[a.severity] ?? 3) - (ranks[b.severity] ?? 3))
    .slice(0, 4)

  if (!selected.length) {
    redirect('/projects/' + parsed.data.project_id + '/fixes?message=' + encodeURIComponent('No new action-justified fixes in that priority range.'))
  }

  let started = 0
  let generated = 0
  const failures: string[] = []

  for (const finding of selected) {
    const { data, error } = await supabase.functions.invoke('blueprint-generator', {
      body: {
        project_id: parsed.data.project_id,
        finding_id: finding.id,
        regenerate: false,
      },
    })

    if (error || data?.error) {
      const detail = data?.message || data?.error
        ? String(data?.message || data?.error)
        : await edgeFunctionErrorMessage(error)
      failures.push(detail)
      continue
    }

    if (data?.pending) started++
    else generated++
  }

  const completedText = generated
    ? generated + ' Blueprint' + (generated === 1 ? '' : 's') + ' ready'
    : ''
  const startedText = started
    ? started + ' Blueprint' + (started === 1 ? '' : 's') + ' building in the background'
    : ''
  const successText = [completedText, startedText].filter(Boolean).join('; ')
  const message = failures.length
    ? (successText ? successText + '; ' : '') + failures.length + ' need attention.'
    : successText || 'Blueprint generation started.'

  redirect('/projects/' + parsed.data.project_id + '/fixes?message=' + encodeURIComponent(message))
}
