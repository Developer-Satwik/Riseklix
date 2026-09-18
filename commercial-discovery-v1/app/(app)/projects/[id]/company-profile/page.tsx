import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { approveCompanyProfile, runCompanyResearch, saveCompanyProfile } from './actions'
import { PendingButton } from '@/components/pending-button'

function listText(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    : ''
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)) : []
}

export default async function CompanyProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: profile }, { data: job }, { data: sources }] = await Promise.all([
    supabase.from('company_profile_versions').select('*').eq('project_id', id).eq('is_current', true).single(),
    supabase.from('research_jobs').select('id,status,progress,stage,created_at,completed_at,error').eq('project_id', id).eq('job_type', 'company_research').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('research_sources').select('id,url,title,source_type,captured_at,metadata').eq('project_id', id).order('captured_at', { ascending: false }).limit(12),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const approved = profile?.status === 'approved'
  const products = list(profile?.products)
  const services = list(profile?.services)
  const audiences = list(profile?.audiences)
  const geographies = list(profile?.geographies)
  const uncertainty = list(profile?.uncertainty)

  return (
    <div className="project-page profile-page">
      <section className="page-header compact">
        <div>
          <div className="eyebrow">COMPANY INTELLIGENCE</div>
          <h1>First, make sure Riseklix understands the business.</h1>
          <p>The company premise is approved before Buyer Situations exist. Public evidence, user-confirmed facts and uncertainty stay visibly separate.</p>
        </div>
      </section>

      {error && <div className="form-alert error" role="alert">{error}</div>}
      {message && <div className="form-alert success" role="status" aria-live="polite">{message}</div>}

      <section className="profile-research-strip">
        <div>
          <span className="research-state-dot" data-state={job?.status || 'not_started'} aria-hidden="true" />
          <div>
            <div className="eyebrow">COMPANY EVIDENCE</div>
            <strong>{job?.status === 'succeeded' ? (sources?.length ?? 0) + ' source' + (sources?.length === 1 ? '' : 's') + ' captured' : job?.status === 'failed' ? 'Latest capture needs attention' : job?.status === 'running' ? 'Research in progress' : 'Not started'}</strong>
            <small>{job?.stage ? job.stage.replaceAll('_', ' ') : 'Direct company pages first; indexed first-party fallback only if the site blocks automated access'}</small>
          </div>
        </div>
        <form action={runCompanyResearch}>
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="regenerate" value={job?.status === 'succeeded' ? 'true' : 'false'} />
          <PendingButton pendingLabel="Researching company…">{job?.status === 'succeeded' ? 'Refresh evidence' : 'Run company research'}</PendingButton>
        </form>
      </section>

      {profile && (
        <>
          <section className="profile-snapshot">
            <header>
              <div>
                <div className="eyebrow">OUR CURRENT UNDERSTANDING</div>
                <h2>{profile.company_name}</h2>
                <p>{profile.summary || 'No company summary has been confirmed yet.'}</p>
              </div>
              <span className={approved ? 'profile-status approved' : 'profile-status'}>{approved ? 'Approved' : 'Needs review'}</span>
            </header>

            <div className="profile-snapshot-grid">
              <div>
                <small>Business model</small>
                <strong>{profile.business_model || 'Needs confirmation'}</strong>
              </div>
              <div>
                <small>Industry</small>
                <strong>{profile.industry || 'Needs confirmation'}</strong>
              </div>
            </div>

            <div className="profile-fact-group">
              <small>What you sell / provide</small>
              <div className="fact-chips">{[...products, ...services].slice(0, 12).map((item) => <span key={item}>{item}</span>)}</div>
              {!products.length && !services.length && <p>Nothing confirmed yet.</p>}
            </div>

            <div className="profile-fact-columns">
              <div>
                <small>Likely buyer groups</small>
                <ul>{audiences.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
                {!audiences.length && <p>Needs confirmation.</p>}
              </div>
              <div>
                <small>Geographies</small>
                <ul>{geographies.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
                {!geographies.length && <p>Needs confirmation.</p>}
              </div>
            </div>

            <div className="uncertainty-box">
              <div className="eyebrow">WHAT WE ARE LESS CERTAIN ABOUT</div>
              {uncertainty.length ? <ul>{uncertainty.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul> : <p>No explicit uncertainty recorded. That does not mean every public claim is independently verified.</p>}
            </div>
          </section>

          <div className="profile-decision-row">
            <details className="profile-editor" open={!approved}>
              <summary>{approved ? 'Edit company context' : 'Review and correct company context'}<span>Every edit reopens this approval gate.</span></summary>
              <form action={saveCompanyProfile} className="profile-review-form">
                <input type="hidden" name="project_id" value={id} />
                <label>Company name<input name="company_name" defaultValue={profile.company_name ?? ''} required /></label>
                <label>Industry<input name="industry" defaultValue={profile.industry ?? ''} placeholder="e.g. industrial access equipment" /></label>
                <label className="full">Business model<input name="business_model" defaultValue={profile.business_model ?? ''} placeholder="e.g. manufacture + sale + rental + installation" /></label>
                <label className="full">Company summary<textarea name="summary" defaultValue={profile.summary ?? ''} minLength={20} required /></label>
                <label>Products<textarea name="products" defaultValue={listText(profile.products)} placeholder={'Aluminium scaffolding\nFRP ladders'} /></label>
                <label>Services / how customers buy<textarea name="services" defaultValue={listText(profile.services)} placeholder={'Purchase\nRental\nInstallation support'} /></label>
                <label>Buyer groups<textarea name="audiences" defaultValue={listText(profile.audiences)} placeholder={'EPC contractors\nFacility managers'} /></label>
                <label>Geographies<textarea name="geographies" defaultValue={listText(profile.geographies)} placeholder={'India\nDelhi NCR\nMumbai'} /></label>
                <label className="full">What we are less certain about<textarea name="uncertainty" defaultValue={listText(profile.uncertainty)} placeholder={'Exact local inventory by depot\nGuaranteed response SLA'} /></label>
                <div className="profile-form-actions full"><PendingButton pendingLabel="Saving profile…">Save reviewed profile</PendingButton></div>
              </form>
            </details>

            <form action={approveCompanyProfile} className={approved ? 'profile-approval-card approved' : 'profile-approval-card'}>
              <input type="hidden" name="project_id" value={id} />
              <div className="eyebrow">HUMAN APPROVAL GATE</div>
              <h3>{approved ? 'Company context approved.' : 'Does this materially describe the business correctly?'}</h3>
              <p>Approval unlocks Buyer Situation generation. It does not certify every external claim as true.</p>
              <PendingButton pendingLabel="Approving…" disabled={approved}>{approved ? 'Approved' : 'Approve company context'}</PendingButton>
            </form>
          </div>
        </>
      )}

      {!!sources?.length && (
        <details className="evidence-drawer">
          <summary>
            <span><strong>Evidence view</strong><small>{sources.length} captured company source{sources.length === 1 ? '' : 's'}</small></span>
            <span aria-hidden="true">+</span>
          </summary>
          <div className="evidence-list">
            {sources.map((source) => {
              const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata) ? source.metadata as Record<string, unknown> : {}
              const sourceRole = typeof metadata.source_role === 'string' ? metadata.source_role.replaceAll('_', ' ') : source.source_type.replaceAll('_', ' ')
              return (
                <article key={source.id}>
                  <div>
                    <span>{sourceRole}</span>
                    <strong>{source.title || source.url}</strong>
                    <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                  </div>
                  <small>{source.captured_at ? new Date(source.captured_at).toLocaleString() : 'Not timestamped'} · {typeof metadata.http_status === 'number' ? 'HTTP ' + metadata.http_status : 'status unknown'}</small>
                </article>
              )
            })}
          </div>
        </details>
      )}

      <section className="next-step-panel">
        <div className="eyebrow">NEXT</div>
        <h2>{approved ? 'Now model the situations where buyers could legitimately consider you.' : 'Approve the company premise before anything downstream is allowed to look certain.'}</h2>
        <p>{approved ? 'Riseklix will combine buyer, job, constraint, required capability, geography and commercial model before it creates any prompt wording.' : 'This gate protects every later benchmark from being built on the wrong understanding of the business.'}</p>
        {approved && <Link href={'/projects/' + id + '/buyer-situations'} className="next-step-link">Open Buyer Situations →</Link>}
      </section>
    </div>
  )
}
