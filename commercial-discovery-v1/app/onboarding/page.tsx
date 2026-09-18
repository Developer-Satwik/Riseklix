import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { completeOnboarding } from './actions'

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const errorMessage = typeof params.error === 'string' ? params.error : null
  const supabase = await createClient()
  const { data: claims, error } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub

  if (error || typeof userId !== 'string') redirect('/login')

  const [{ data: profile }, { data: workspaces }] = await Promise.all([
    supabase.from('profiles').select('display_name,avatar_url,onboarding_completed_at').eq('id', userId).maybeSingle(),
    supabase.from('workspaces').select('name').order('created_at', { ascending: true }).limit(1),
  ])

  if (profile?.onboarding_completed_at) redirect('/projects')

  const metadata = claims?.claims?.user_metadata && typeof claims.claims.user_metadata === 'object'
    ? claims.claims.user_metadata as Record<string, unknown>
    : {}

  const defaultName = profile?.display_name
    || (typeof metadata.full_name === 'string' ? metadata.full_name : null)
    || (typeof metadata.name === 'string' ? metadata.name : null)
    || (typeof claims?.claims?.email === 'string' ? claims.claims.email.split('@')[0] : '')

  return (
    <main className="auth-shell onboarding-shell">
      <section className="auth-card onboarding-card">
        <Link href="/" className="wordmark brand-wordmark auth-brand" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">ONE-TIME SETUP</div>
        <h1>Set up your workspace.</h1>
        <p>Two details, then you can analyze any company. Your organization is the team using Riseklix; it does not have to be the company you analyze.</p>

        {errorMessage && <div className="form-alert error" role="alert">{errorMessage}</div>}

        <form action={completeOnboarding} className="auth-form onboarding-form">
          <label>
            Your name
            <input name="display_name" type="text" defaultValue={defaultName} autoComplete="name" minLength={2} maxLength={80} required />
          </label>
          <label>
            Organization name
            <input name="organization_name" type="text" defaultValue={workspaces?.[0]?.name === 'My Workspace' ? '' : workspaces?.[0]?.name || ''} autoComplete="organization" minLength={2} maxLength={120} placeholder="Acme, Riseklix Media, Your Agency…" required />
          </label>

          <div className="onboarding-note">
            <span>What happens next</span>
            <p>Enter a company URL, choose AI Autopilot or Manual Editing, then confirm the Company Intelligence profile once.</p>
          </div>

          <button type="submit" className="auth-primary">Continue to my first analysis →</button>
        </form>

        <form action="/auth/signout" method="post" className="onboarding-signout"><button type="submit">Use another account</button></form>
      </section>
    </main>
  )
}
