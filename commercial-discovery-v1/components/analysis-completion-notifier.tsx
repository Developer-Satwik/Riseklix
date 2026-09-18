'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const ENABLED_KEY = 'riseklix.analysis.notifications'
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
      if (window.localStorage.getItem(ENABLED_KEY) !== 'true') return
      if (!('Notification' in window) || Notification.permission !== 'granted') return

      const supabase = createClient()
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
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

      let registration: ServiceWorkerRegistration | null = null
      if ('serviceWorker' in navigator) {
        try {
          registration = await navigator.serviceWorker.register('/analysis-notifications-sw.js')
        } catch {
          registration = null
        }
      }

      for (const run of unseen) {
        if (cancelled) return
        const name = names.get(run.project_id) || 'Your company'
        try {
          if (registration) {
            await registration.showNotification('Your Riseklix analysis is ready', {
              body: name + ' has finished Commercial Discovery. Open the report to review the evidence and prioritized fixes.',
              tag: 'riseklix-analysis-' + run.project_id,
              data: { url: '/projects/' + run.project_id + '/report' },
            })
          } else {
            new Notification('Your Riseklix analysis is ready', {
              body: name + ' has finished Commercial Discovery.',
            })
          }
        } catch {
          // Notification delivery is best-effort.
        }
        seen.add(run.project_id)
      }

      saveSeen(seen)
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
