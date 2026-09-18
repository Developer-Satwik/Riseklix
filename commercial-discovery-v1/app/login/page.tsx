import Link from 'next/link'
import { TurnstileWidget } from '@/components/turnstile-widget'
import { login, signup } from './actions'
import { OAuthButtons } from '@/components/oauth-buttons'

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const message = typeof params.message === 'string' ? params.message : null

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-login">
        <Link href="/" className="wordmark brand-wordmark auth-brand" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">AI COMMERCIAL DISCOVERY</div>
        <h1>See how AI discovers your business.</h1>
        <p>Sign in once. Riseklix keeps each company, benchmark and evidence chain inside your organization workspace.</p>

        {error && <div className="form-alert error" role="alert">{error}</div>}
        {message && <div className="form-alert success" role="status" aria-live="polite">{message}</div>}

        <OAuthButtons />

        <div className="auth-divider"><span>or continue with email</span></div>

        <form className="auth-form">
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} maxLength={128} required /></label>
          <div className="auth-inline-row">
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
          <TurnstileWidget />
          <div className="auth-actions">
            <button formAction={login}>Sign in</button>
            <button formAction={signup} className="secondary-button">Create account</button>
          </div>
        </form>

        <p className="auth-legal">By continuing, you agree to the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Policy</Link>.</p>
      </section>
    </main>
  )
}
