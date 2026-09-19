'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  disableAnalysisNotifications,
  enableAnalysisNotifications,
  getAnalysisNotificationState,
  type AnalysisNotificationState,
} from '@/lib/analysis-notifications'

type State = AnalysisNotificationState | 'loading'

export function AnalysisNotificationSetting() {
  const [state, setState] = useState<State>('loading')

  const syncState = useCallback(() => {
    setState(getAnalysisNotificationState())
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncState)

    const onFocus = () => syncState()
    window.addEventListener('focus', onFocus)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('focus', onFocus)
    }
  }, [syncState])

  async function enable() {
    const next = await enableAnalysisNotifications({ sendTest: true })
    setState(next)
  }

  function disable() {
    disableAnalysisNotifications()
    setState('off')
  }

  const isOn = state === 'on'
  const disabled = state === 'blocked' || state === 'unsupported' || state === 'loading'

  return (
    <div className="settings-notification-control">
      <div>
        <strong>Analysis completion</strong>
        <p>Get a browser notification when an Autopilot analysis finishes while Riseklix is open in this browser.</p>
        {isOn && <small className="notification-setting-success">Enabled for this browser. Turning it off here keeps the browser permission untouched, so you can re-enable it without another permission prompt.</small>}
        {state === 'blocked' && <small>Blocked by your browser. Re-enable notifications in this site&apos;s browser permissions, then return here.</small>}
        {state === 'unsupported' && <small>This browser or device does not support Riseklix browser notifications here.</small>}
      </div>

      <button
        type="button"
        className={isOn ? 'settings-toggle active' : 'settings-toggle'}
        onClick={isOn ? disable : enable}
        disabled={disabled}
        aria-pressed={isOn}
      >
        <i />
        {state === 'loading' ? '…' : isOn ? 'On' : 'Off'}
      </button>
    </div>
  )
}
