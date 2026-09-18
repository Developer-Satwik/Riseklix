'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  project_id: z.string().uuid(),
  scope: z.enum(['critical', 'high', 'all']),
})

const ranks: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
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
      failures.push(String(data?.message || data?.error || error?.message || 'Blueprint generation failed'))
      continue
    }

    generated++
  }

  const message = failures.length
    ? generated + ' fix Blueprint' + (generated === 1 ? '' : 's') + ' generated; ' + failures.length + ' need attention.'
    : generated + ' prioritized fix Blueprint' + (generated === 1 ? '' : 's') + ' generated for review.'

  redirect('/projects/' + parsed.data.project_id + '/fixes?message=' + encodeURIComponent(message))
}
