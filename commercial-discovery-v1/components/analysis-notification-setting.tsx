'use client'

import { useEffect, useState } from 'react'

type State = 'loading' | 'unsupported' | 'off' | 'on' | 'blocked'

export function AnalysisNotificationSetting() {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!('Notification' in window)) {
        setState('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        setState('blocked')
        return
      }
      const enabled = window.localStorage.getItem('riseklix.analysis.notifications') === 'true'
      setState(enabled && Notification.permission === 'granted' ? 'on' : 'off')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  async function enable() {
    if (!('Notification' in window)) {
      setState('unsupported')
      return
    }

    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      window.localStorage.setItem('riseklix.analysis.notifications', 'true')
      window.localStorage.setItem('riseklix.analysis.notifications.enabled_at', new Date().toISOString())
      setState('on')
      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.register('/analysis-notifications-sw.js')
        } catch {
          // The preference can still be used by desktop notification fallback.
        }
      }
      return
    }

    setState(permission === 'denied' ? 'blocked' : 'off')
  }

  function disable() {
    window.localStorage.setItem('riseklix.analysis.notifications', 'false')
    setState('off')
  }

  return (
    <div className="settings-notification-control">
      <div>
        <strong>Analysis completion</strong>
        <p>Get a browser notification when an Autopilot analysis finishes while Riseklix is open in this browser.</p>
        {state === 'blocked' && <small>Blocked by your browser. Use the site-permission control in the address bar to re-enable notifications.</small>}
        {state === 'unsupported' && <small>This browser does not support web notifications.</small>}
      </div>

      {state === 'on' ? (
        <button type="button" className="settings-toggle active" onClick={disable} aria-pressed="true"><i />On</button>
      ) : (
        <button type="button" className="settings-toggle" onClick={enable} disabled={state === 'blocked' || state === 'unsupported' || state === 'loading'} aria-pressed="false"><i />Off</button>
      )}
    </div>
  )
}
