'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { resumeAutopilot } from '@/app/(app)/projects/[id]/overview/autopilot-actions'

type NotificationState = 'unsupported' | 'default' | 'granted' | 'denied'

export function AutopilotProcessingClient({
  projectId,
  projectName,
  complete,
  paused,
}: {
  projectId: string
  projectName: string
  complete: boolean
  paused: boolean
}) {
  const router = useRouter()
  const started = useRef(false)
  const notified = useRef(false)
  const [notificationState, setNotificationState] = useState<NotificationState>('default')

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!('Notification' in window)) {
        setNotificationState('unsupported')
        return
      }
      setNotificationState(Notification.permission as NotificationState)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (complete) return

    const refreshTimer = window.setInterval(() => router.refresh(), 3500)
    return () => window.clearInterval(refreshTimer)
  }, [complete, router])

  useEffect(() => {
    if (complete || paused || started.current) return
    started.current = true
    void resumeAutopilot(projectId)
  }, [complete, paused, projectId])

  useEffect(() => {
    if (!complete || notified.current) return
    notified.current = true

    async function finish() {
      const shouldNotify = window.localStorage.getItem('riseklix.analysis.notifications') === 'true'

      if (shouldNotify && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const registration = 'serviceWorker' in navigator
            ? await navigator.serviceWorker.register('/analysis-notifications-sw.js')
            : null

          if (registration) {
            await registration.showNotification('Your Riseklix analysis is ready', {
              body: projectName + ' has finished Commercial Discovery. Open the report to review findings and prioritized fixes.',
              tag: 'riseklix-analysis-' + projectId,
              data: { url: '/projects/' + projectId + '/report' },
            })
          } else {
            new Notification('Your Riseklix analysis is ready', {
              body: projectName + ' has finished Commercial Discovery.',
            })
          }
        } catch {
          // Notification delivery is best-effort; report navigation should never depend on it.
        }
      }

      window.setTimeout(() => router.replace('/projects/' + projectId + '/report'), 650)
    }

    void finish()
  }, [complete, projectId, projectName, router])

  async function enableNotifications() {
    if (!('Notification' in window)) {
      setNotificationState('unsupported')
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationState(permission as NotificationState)

    if (permission === 'granted') {
      window.localStorage.setItem('riseklix.analysis.notifications', 'true')
      window.localStorage.setItem('riseklix.analysis.notifications.enabled_at', new Date().toISOString())
      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.register('/analysis-notifications-sw.js')
        } catch {
          // The processing page still works without a service worker.
        }
      }
    }
  }

  function disableNotifications() {
    window.localStorage.setItem('riseklix.analysis.notifications', 'false')
    setNotificationState('default')
  }

  return (
    <div className="autopilot-notify">
      {notificationState === 'granted' ? (
        <>
          <span><i aria-hidden="true">✓</i> Browser notification enabled</span>
          <button type="button" onClick={disableNotifications}>Turn off</button>
        </>
      ) : notificationState === 'denied' ? (
        <span>Notifications are blocked in this browser. The report will still open automatically here when ready.</span>
      ) : notificationState === 'unsupported' ? (
        <span>This browser does not support system notifications. You can leave this tab open and Riseklix will move to the report when finished.</span>
      ) : (
        <>
          <span>Want to work on something else?</span>
          <button type="button" onClick={enableNotifications}>Notify me when ready</button>
        </>
      )}
    </div>
  )
}
