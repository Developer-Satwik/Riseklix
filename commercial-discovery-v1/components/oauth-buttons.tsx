'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Provider = 'google' | 'azure'

export function OAuthButtons() {
  const [pending, setPending] = useState<Provider | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function beginOAuth(provider: Provider) {
    setPending(provider)
    setError(null)

    const supabase = createClient()
    const redirectTo = window.location.origin + '/auth/callback'

    const { data, error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    })

    if (authError) {
      setPending(null)
      setError(authError.message || 'Could not start sign in')
      return
    }

    // Supabase redirects automatically in the browser. Keep this fallback for
    // browsers/environments that return the provider URL without navigating.
    if (data.url) window.location.assign(data.url)
  }

  return (
    <>
      {error && <div className="form-alert error oauth-inline-error" role="alert">{error}</div>}
      <div className="oauth-stack">
        <button
          type="button"
          className="oauth-button"
          onClick={() => beginOAuth('google')}
          disabled={pending !== null}
        >
          <span>G</span>
          {pending === 'google' ? 'Connecting to Google…' : 'Continue with Google'}
        </button>

        <button
          type="button"
          className="oauth-button"
          onClick={() => beginOAuth('azure')}
          disabled={pending !== null}
        >
          <span className="microsoft-mark" aria-hidden="true" />
          {pending === 'azure' ? 'Connecting to Microsoft…' : 'Continue with Microsoft'}
        </button>
      </div>
    </>
  )
}
