import Link from 'next/link'
import { login, signup } from './actions'

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const message = typeof params.message === 'string' ? params.message : null

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link href="/" className="wordmark brand-wordmark auth-brand" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">COMMERCIAL DISCOVERY WORKSPACE</div>
        <h1>Sign in to your research workspace.</h1>
        <p>One account can hold multiple company projects while keeping each benchmark and evidence chain separate.</p>
        {error && <div className="form-alert error" role="alert">{error}</div>}
        {message && <div className="form-alert success" role="status" aria-live="polite">{message}</div>}
        <form className="auth-form">
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
          <div className="auth-actions">
            <button formAction={login}>Sign in</button>
            <button formAction={signup} className="secondary-button">Create account</button>
          </div>
        </form>
      </section>
    </main>
  )
}
