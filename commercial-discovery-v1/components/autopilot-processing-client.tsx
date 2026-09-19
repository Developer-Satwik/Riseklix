'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { resumeAutopilot } from '@/app/(app)/projects/[id]/overview/autopilot-actions'
import {
  enableAnalysisNotifications,
  shouldOfferAnalysisNotifications,
  snoozeAnalysisNotificationPrompt,
} from '@/lib/analysis-notifications'

type NotificationPromptState = 'hidden' | 'offer' | 'success'

export function AutopilotProcessingClient({
  projectId,
  complete,
  paused,
  activeJobCount,
}: {
  projectId: string
  complete: boolean
  paused: boolean
  activeJobCount: number
}) {
  const router = useRouter()
  const lastResumeAt = useRef(0)
  const successTimer = useRef<number | null>(null)
  const [notificationPrompt, setNotificationPrompt] = useState<NotificationPromptState>('hidden')

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (shouldOfferAnalysisNotifications()) setNotificationPrompt('offer')
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (successTimer.current) window.clearTimeout(successTimer.current)
    }
  }, [])

  useEffect(() => {
    if (complete) return

    const refreshTimer = window.setInterval(() => router.refresh(), 3500)
    return () => window.clearInterval(refreshTimer)
  }, [complete, router])

  useEffect(() => {
    if (complete || paused || activeJobCount > 0) return

    let cancelled = false

    async function resumeIfIdle() {
      if (cancelled) return
      const now = Date.now()
      if (now - lastResumeAt.current < 10_000) return
      lastResumeAt.current = now
      await resumeAutopilot(projectId)
      if (!cancelled) router.refresh()
    }

    void resumeIfIdle()
    const timer = window.setInterval(() => void resumeIfIdle(), 10_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeJobCount, complete, paused, projectId, router])

  async function enableNotifications() {
    const next = await enableAnalysisNotifications({ sendTest: true })

    if (next === 'on') {
      setNotificationPrompt('success')
      successTimer.current = window.setTimeout(() => setNotificationPrompt('hidden'), 2800)
      return
    }

    setNotificationPrompt('hidden')
  }

  function notNow() {
    snoozeAnalysisNotificationPrompt()
    setNotificationPrompt('hidden')
  }

  if (notificationPrompt === 'hidden') return null

  return (
    <div className={'autopilot-notify ' + (notificationPrompt === 'success' ? 'success' : '')} role="status" aria-live="polite">
      {notificationPrompt === 'success' ? (
        <span><i aria-hidden="true">✓</i> Notifications are on. You can change this anytime in Settings.</span>
      ) : (
        <>
          <div>
            <strong>Get notified when this analysis is ready</strong>
            <span>Allow once in your browser. Notification preferences stay in Settings.</span>
          </div>
          <div className="autopilot-notify-actions">
            <button type="button" onClick={enableNotifications}>Allow notifications</button>
            <button type="button" className="quiet" onClick={notNow}>Not now</button>
          </div>
        </>
      )}
    </div>
  )
}
