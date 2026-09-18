import Link from 'next/link'
import { updatePassword } from './actions'

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-narrow">
        <Link href="/" className="wordmark brand-wordmark auth-brand" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">NEW PASSWORD</div>
        <h1>Choose a new password.</h1>
        <p>Use at least 10 characters. A password manager-generated password is best.</p>
        {error && <div className="form-alert error" role="alert">{error}</div>}
        <form action={updatePassword} className="auth-form">
          <label>New password<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
          <label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" minLength={10} required /></label>
          <button type="submit">Update password</button>
        </form>
      </section>
    </main>
  )
}
