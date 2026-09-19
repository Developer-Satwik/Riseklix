'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ANALYSIS_NOTIFICATION_ENABLED_AT_KEY,
  getAnalysisNotificationState,
  showAnalysisNotification,
} from '@/lib/analysis-notifications'

const SEEN_KEY = 'riseklix.analysis.notifications.seen'

function seenIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function saveSeen(ids: Set<string>) {
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(ids).slice(-100)))
}

export function AnalysisCompletionNotifier() {
  useEffect(() => {
    let cancelled = false

    async function checkCompleted() {
      if (cancelled) return
      if (getAnalysisNotificationState() !== 'on') return

      const supabase = createClient()
      const fallbackCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const enabledAt = window.localStorage.getItem(ANALYSIS_NOTIFICATION_ENABLED_AT_KEY)
      const cutoff = enabledAt && !Number.isNaN(Date.parse(enabledAt)) && enabledAt > fallbackCutoff
        ? enabledAt
        : fallbackCutoff
      const { data: runs } = await supabase
        .from('autopilot_runs')
        .select('project_id,completed_at')
        .eq('status', 'complete')
        .gte('completed_at', cutoff)
        .order('completed_at', { ascending: true })

      if (!runs?.length || cancelled) return

      const seen = seenIds()
      const unseen = runs.filter((run) => run.completed_at && !seen.has(run.project_id))
      if (!unseen.length) return

      const ids = unseen.map((run) => run.project_id)
      const { data: projects } = await supabase.from('projects').select('id,name').in('id', ids)
      const names = new Map((projects ?? []).map((project) => [project.id, project.name]))

      let changed = false

      for (const run of unseen) {
        if (cancelled) return
        const name = names.get(run.project_id) || 'Your company'
        const delivered = await showAnalysisNotification('Your Riseklix analysis is ready', {
          body: name + ' has finished Commercial Discovery. Open the report to review the evidence and prioritized fixes.',
          tag: 'riseklix-analysis-' + run.project_id,
          data: { url: '/projects/' + run.project_id + '/report' },
        })

        if (!delivered) continue
        seen.add(run.project_id)
        changed = true
      }

      if (changed) saveSeen(seen)
    }

    void checkCompleted()
    const timer = window.setInterval(() => void checkCompleted(), 12000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return null
}
