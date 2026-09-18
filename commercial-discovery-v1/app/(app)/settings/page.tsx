import { createClient } from '@/lib/supabase/server'
import { updateWorkspaceIdentity } from './actions'

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const message = typeof params.message === 'string' ? params.message : null
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub

  const [{ data: profile }, { data: workspace }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
    supabase.from('workspaces').select('name').order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  return (
    <div className="page-wrap settings-page">
      <header className="page-header compact">
        <div className="eyebrow">WORKSPACE SETTINGS</div>
        <h1>Account & organization.</h1>
        <p>These details identify the team using Riseklix. They are separate from the companies you analyze.</p>
      </header>

      {error && <div className="form-alert error" role="alert">{error}</div>}
      {message && <div className="form-alert success" role="status">{message}</div>}

      <section className="settings-card">
        <form action={updateWorkspaceIdentity} className="auth-form">
          <label>Your name<input name="display_name" defaultValue={profile?.display_name || ''} minLength={2} maxLength={80} required /></label>
          <label>Organization name<input name="organization_name" defaultValue={workspace?.name || ''} minLength={2} maxLength={120} required /></label>
          <button type="submit">Save changes</button>
        </form>
      </section>
    </div>
  )
}
