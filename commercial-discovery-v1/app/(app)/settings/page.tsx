import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { revokeOtherSessions, updateProfile, updateResearchDefaults, updateWorkspace } from './actions'
import { SettingsForm } from '@/components/settings-form'
import { AnalysisNotificationSetting } from '@/components/analysis-notification-setting'

const settingsNav = [
  ['profile', 'Profile'],
  ['workspace', 'Workspace'],
  ['research', 'Research defaults'],
  ['notifications', 'Notifications'],
  ['security', 'Security'],
  ['data', 'Data & support'],
] as const

function providerLabel(provider: string) {
  if (provider === 'google') return 'Google'
  if (provider === 'azure') return 'Microsoft'
  if (provider === 'email') return 'Email & password'
  return provider
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null
  const message = typeof params.message === 'string' ? params.message : null
  const activeSection = typeof params.section === 'string' ? params.section : null

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData.user

  const membershipsResult = user
    ? await supabase
      .from('workspace_members')
      .select('workspace_id, role, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    : { data: [] }

  const memberships = membershipsResult.data ?? []
  const membership =
    memberships.find((item) => item.role === 'owner') ??
    memberships.find((item) => item.role === 'admin') ??
    memberships[0] ??
    null

  const [{ data: profile }, { data: workspace }] = await Promise.all([
    user
      ? supabase
        .from('profiles')
        .select('display_name, avatar_url, default_market, default_analysis_mode, default_primary_language')
        .eq('id', user.id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    membership?.workspace_id
      ? supabase
        .from('workspaces')
        .select('id, name, created_at')
        .eq('id', membership.workspace_id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const [{ count: memberCount }, { count: projectCount }] = membership?.workspace_id
    ? await Promise.all([
      supabase
        .from('workspace_members')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', membership.workspace_id),
      supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', membership.workspace_id),
    ])
    : [{ count: 0 }, { count: 0 }]

  const rawProviders = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : user?.app_metadata?.provider
      ? [user.app_metadata.provider]
      : []
  const providers = Array.from(new Set(rawProviders.map((provider) => providerLabel(String(provider)))))
  const email = user?.email ?? 'No email available'
  const canRenameWorkspace = membership?.role === 'owner'

  return (
    <div className="page-wrap settings-page settings-page-expanded">
      <header className="settings-hero">
        <div>
          <div className="eyebrow">SETTINGS</div>
          <h1>Control the account behind the research.</h1>
          <p>Manage your identity, workspace, default analysis behavior, account security, and data links. Company-specific choices stay inside each analysis.</p>
        </div>
        <span className="settings-role-badge">{membership?.role ?? 'member'}</span>
      </header>

      <div className="settings-layout">
        <aside className="settings-local-nav" aria-label="Settings sections">
          <span>Settings</span>
          <nav>
            {settingsNav.map(([id, label]) => (
              <a key={id} href={'#' + id} className={activeSection === id ? 'active' : ''}>{label}</a>
            ))}
          </nav>
        </aside>

        <div className="settings-content">
          {error && (
            <div className="form-alert error settings-alert" role="alert">{error}</div>
          )}

          <section className="settings-section" id="profile">
            <header>
              <div>
                <span>Account</span>
                <h2>Profile</h2>
                <p>Your personal identity inside Riseklix. This is separate from the companies you analyze.</p>
              </div>
            </header>

            <SettingsForm
              action={updateProfile}
              submitLabel="Save profile"
              saved={activeSection === 'profile' && Boolean(message)}
            >
              <div className="settings-field-row">
                <div>
                  <label htmlFor="display_name">Your name</label>
                  <p>Shown in your workspace and attached to review activity.</p>
                </div>
                <input id="display_name" name="display_name" defaultValue={profile?.display_name || ''} minLength={2} maxLength={80} required />
              </div>

              <div className="settings-field-row settings-readonly-row">
                <div>
                  <label>Email address</label>
                  <p>Your sign-in identity. Email changes are not self-service during the beta.</p>
                </div>
                <div className="settings-value-stack">
                  <strong>{email}</strong>
                  <div className="settings-chip-row">
                    {providers.map((provider) => <span className="settings-chip" key={provider}>{provider}</span>)}
                  </div>
                </div>
              </div>

            </SettingsForm>
          </section>

          <section className="settings-section" id="workspace">
            <header>
              <div>
                <span>Organization</span>
                <h2>Workspace</h2>
                <p>The team using Riseklix. Workspace identity never becomes the identity of a company being researched.</p>
              </div>
              <div className="settings-section-meta">
                <span>{memberCount ?? 0} member{memberCount === 1 ? '' : 's'}</span>
                <span>{projectCount ?? 0} project{projectCount === 1 ? '' : 's'}</span>
              </div>
            </header>

            <SettingsForm
              action={updateWorkspace}
              submitLabel="Save workspace"
              saved={activeSection === 'workspace' && Boolean(message)}
              disabled={!canRenameWorkspace}
              footerNote={canRenameWorkspace ? undefined : 'Only the workspace owner can rename this workspace.'}
            >
              <div className="settings-field-row">
                <div>
                  <label htmlFor="organization_name">Organization name</label>
                  <p>Used in the sidebar and workspace context.</p>
                </div>
                <input
                  id="organization_name"
                  name="organization_name"
                  defaultValue={workspace?.name || ''}
                  minLength={2}
                  maxLength={120}
                  required
                  disabled={!canRenameWorkspace}
                />
              </div>

              <div className="settings-field-row settings-readonly-row">
                <div>
                  <label>Your workspace role</label>
                  <p>Owners control workspace identity. Broader member administration will appear here when team invitations ship.</p>
                </div>
                <div className="settings-value-stack"><strong className="settings-role-text">{membership?.role ?? 'member'}</strong></div>
              </div>

            </SettingsForm>
          </section>

          <section className="settings-section" id="research">
            <header>
              <div>
                <span>Commercial Discovery</span>
                <h2>Research defaults</h2>
                <p>Set the starting point for new analyses. You can still override these choices on each new company.</p>
              </div>
            </header>

            <SettingsForm
              action={updateResearchDefaults}
              submitLabel="Save research defaults"
              saved={activeSection === 'research' && Boolean(message)}
            >
              <div className="settings-field-row">
                <div>
                  <label htmlFor="default_market">Default market</label>
                  <p>Preselected geography when you start a new analysis.</p>
                </div>
                <select id="default_market" name="default_market" defaultValue={profile?.default_market || 'Global'}>
                  <option>Global</option>
                  <option>India</option>
                  <option>United States</option>
                  <option>United Kingdom</option>
                  <option>UAE</option>
                  <option>Singapore</option>
                  <option>Australia</option>
                </select>
              </div>

              <div className="settings-field-row">
                <div>
                  <label htmlFor="default_primary_language">Default research language</label>
                  <p>The primary language used for new project prompts and observations.</p>
                </div>
                <select id="default_primary_language" name="default_primary_language" defaultValue={profile?.default_primary_language || 'English'}>
                  <option>English</option>
                  <option>Hindi</option>
                  <option>Hinglish</option>
                </select>
              </div>

              <fieldset className="settings-choice-row">
                <legend>
                  <strong>Default analysis mode</strong>
                  <span>Choose how much review control a new project starts with.</span>
                </legend>
                <div>
                  <label>
                    <input type="radio" name="default_analysis_mode" value="autopilot" defaultChecked={(profile?.default_analysis_mode || 'autopilot') === 'autopilot'} />
                    <span><strong>Autopilot</strong><small>Riseklix continues after Company Intelligence confirmation.</small></span>
                  </label>
                  <label>
                    <input type="radio" name="default_analysis_mode" value="manual" defaultChecked={profile?.default_analysis_mode === 'manual'} />
                    <span><strong>Manual Editing</strong><small>Keep approval gates throughout the evaluation.</small></span>
                  </label>
                </div>
              </fieldset>

              <div className="settings-field-row settings-readonly-row">
                <div>
                  <label>Company Intelligence confirmation</label>
                  <p>The company premise must be confirmed once before benchmarking begins.</p>
                </div>
                <span className="settings-status-lock">Required</span>
              </div>

            </SettingsForm>
          </section>

          <section className="settings-section" id="notifications">
            <header>
              <div>
                <span>Autopilot</span>
                <h2>Notifications</h2>
                <p>Control completion alerts for long-running Commercial Discovery analyses.</p>
              </div>
            </header>
            <div className="settings-form">
              <AnalysisNotificationSetting />
            </div>
          </section>

          <section className="settings-section" id="security">
            <header>
              <div>
                <span>Account</span>
                <h2>Security & access</h2>
                <p>Manage recovery and invalidate access from sessions you no longer recognize.</p>
              </div>
            </header>

            <div className="settings-form">
              <div className="settings-action-row">
                <div>
                  <strong>Password & recovery</strong>
                  <p>Send a recovery link through the verified email attached to your account.</p>
                </div>
                <Link href={'/forgot-password?email=' + encodeURIComponent(user?.email || '')} className="settings-secondary-action">Recovery options</Link>
              </div>

              <div className="settings-action-row">
                <div>
                  <strong>Other signed-in sessions</strong>
                  <p>Revoke refresh access on other devices while keeping this session active.</p>
                </div>
                <form action={revokeOtherSessions}><button type="submit" className="settings-secondary-action button-reset">Revoke others</button></form>
              </div>

              <div className="settings-action-row">
                <div>
                  <strong>Sign out everywhere</strong>
                  <p>End all refresh sessions for this account, including the current one.</p>
                </div>
                <form action="/auth/signout" method="post"><button type="submit" className="settings-danger-action">Sign out everywhere</button></form>
              </div>
            </div>
          </section>

          <section className="settings-section" id="data">
            <header>
              <div>
                <span>Control & support</span>
                <h2>Data, privacy & help</h2>
                <p>Review how Commercial Discovery handles research data and get a human involved when you need one.</p>
              </div>
            </header>

            <div className="settings-link-grid">
              <Link href="/privacy"><span>Privacy Policy</span><small>Data categories, AI providers, retention, rights and regional disclosures.</small><b>→</b></Link>
              <Link href="/terms"><span>Terms of Service</span><small>Product use, AI outputs, acceptable use, liability and business terms.</small><b>→</b></Link>
              <Link href="/help"><span>Help & support</span><small>Product guidance, troubleshooting and analysis workflow help.</small><b>→</b></Link>
              <a href="mailto:contact@riseklix.com?subject=Riseklix%20Commercial%20Discovery%20Support"><span>Contact support</span><small>Send a project-specific issue directly to Riseklix.</small><b>→</b></a>
            </div>

            <div className="settings-danger-zone">
              <div>
                <span>Account deletion</span>
                <p>Self-service deletion is not live yet. You can request deletion or export-related assistance from support.</p>
              </div>
              <a href="mailto:contact@riseklix.com?subject=Riseklix%20Account%20Deletion%20Request">Request deletion</a>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
