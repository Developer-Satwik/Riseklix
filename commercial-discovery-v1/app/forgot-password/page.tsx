import Link from 'next/link'
import { TurnstileWidget } from '@/components/turnstile-widget'
import { requestPasswordReset } from './actions'

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const message = typeof params.message === 'string' ? params.message : null
  const email = typeof params.email === 'string' ? params.email : ''

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-narrow">
        <Link href="/" className="wordmark brand-wordmark auth-brand" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h1>Reset your password.</h1>
        <p>We’ll send a recovery link to the email attached to your Riseklix account.</p>
        {error && <div className="form-alert error" role="alert">{error}</div>}
        {message && <div className="form-alert success" role="status">{message}</div>}
        <form action={requestPasswordReset} className="auth-form">
          <label>Email<input name="email" type="email" autoComplete="email" defaultValue={email} required /></label>
          <TurnstileWidget />
          <button type="submit">Send recovery link</button>
        </form>
        <Link href="/login" className="auth-text-link">← Back to sign in</Link>
      </section>
    </main>
  )
}
