'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

export function TurnstileWidget() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const mountRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    if (!siteKey || !mountRef.current) return

    let cancelled = false

    const render = () => {
      if (cancelled || !mountRef.current || !window.turnstile || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(mountRef.current, {
        sitekey: siteKey,
        theme: 'dark',
        size: 'flexible',
        callback: (value: unknown) => setToken(typeof value === 'string' ? value : ''),
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      })
    }

    if (window.turnstile) {
      render()
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-riseklix-turnstile]')
      if (existing) {
        existing.addEventListener('load', render, { once: true })
      } else {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.dataset.riseklixTurnstile = 'true'
        script.addEventListener('load', render, { once: true })
        document.head.appendChild(script)
      }
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  if (!siteKey) return <input type="hidden" name="captcha_token" value="" />

  return (
    <div className="turnstile-wrap">
      <div ref={mountRef} />
      <input type="hidden" name="captcha_token" value={token} />
    </div>
  )
}
