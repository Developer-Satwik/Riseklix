'use client'

export const ANALYSIS_NOTIFICATION_ENABLED_KEY = 'riseklix.analysis.notifications'
export const ANALYSIS_NOTIFICATION_ENABLED_AT_KEY = 'riseklix.analysis.notifications.enabled_at'
export const ANALYSIS_NOTIFICATION_SNOOZE_UNTIL_KEY = 'riseklix.analysis.notifications.snooze_until'

export type AnalysisNotificationState = 'unsupported' | 'blocked' | 'on' | 'off' | 'ask'

const PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

function hasWindow() {
  return typeof window !== 'undefined'
}

export function getAnalysisNotificationState(): AnalysisNotificationState {
  if (!hasWindow() || !('Notification' in window)) return 'unsupported'

  const permission = Notification.permission
  const preference = window.localStorage.getItem(ANALYSIS_NOTIFICATION_ENABLED_KEY)

  if (permission === 'denied') return 'blocked'
  if (preference === 'true' && permission === 'granted') return 'on'
  if (preference === 'false') return 'off'

  return 'ask'
}

export function shouldOfferAnalysisNotifications() {
  if (getAnalysisNotificationState() !== 'ask') return false

  const snoozeUntil = window.localStorage.getItem(ANALYSIS_NOTIFICATION_SNOOZE_UNTIL_KEY)
  if (!snoozeUntil) return true

  const timestamp = Date.parse(snoozeUntil)
  return Number.isNaN(timestamp) || timestamp <= Date.now()
}

export function snoozeAnalysisNotificationPrompt() {
  if (!hasWindow()) return
  window.localStorage.setItem(
    ANALYSIS_NOTIFICATION_SNOOZE_UNTIL_KEY,
    new Date(Date.now() + PROMPT_SNOOZE_MS).toISOString(),
  )
}

export function disableAnalysisNotifications() {
  if (!hasWindow()) return
  window.localStorage.setItem(ANALYSIS_NOTIFICATION_ENABLED_KEY, 'false')
}

async function notificationRegistration() {
  if (!('serviceWorker' in navigator)) return null

  try {
    return await navigator.serviceWorker.register('/analysis-notifications-sw.js')
  } catch {
    return null
  }
}

export async function showAnalysisNotification(
  title: string,
  options: NotificationOptions & { data?: { url?: string } } = {},
) {
  if (!hasWindow() || !('Notification' in window) || Notification.permission !== 'granted') return false

  try {
    const registration = await notificationRegistration()

    if (registration) {
      await registration.showNotification(title, options)
    } else {
      new Notification(title, options)
    }

    return true
  } catch {
    return false
  }
}

export async function enableAnalysisNotifications({
  sendTest = true,
}: {
  sendTest?: boolean
} = {}): Promise<AnalysisNotificationState> {
  if (!hasWindow() || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()

  if (permission !== 'granted') {
    if (permission === 'denied') return 'blocked'
    snoozeAnalysisNotificationPrompt()
    return 'ask'
  }

  window.localStorage.setItem(ANALYSIS_NOTIFICATION_ENABLED_KEY, 'true')
  window.localStorage.setItem(ANALYSIS_NOTIFICATION_ENABLED_AT_KEY, new Date().toISOString())
  window.localStorage.removeItem(ANALYSIS_NOTIFICATION_SNOOZE_UNTIL_KEY)

  await notificationRegistration()

  if (sendTest) {
    await showAnalysisNotification('Riseklix notifications are on', {
      body: 'We’ll alert you when an Autopilot analysis finishes while Riseklix is open in this browser.',
      tag: 'riseklix-analysis-notifications-test',
      data: { url: '/settings#notifications' },
    })
  }

  return 'on'
}
