import { createClient } from '@/lib/supabase/server'
import { approveCompanyProfile, runCompanyResearch, saveCompanyProfile } from './actions'

function listText(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    : ''
}

export default async function CompanyProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: profile }, { data: job }, { data: sources }] = await Promise.all([
    supabase.from('company_profile_versions').select('*').eq('project_id', id).eq('is_current', true).single(),
    supabase.from('research_jobs').select('id,status,progress,stage,created_at,completed_at,error').eq('project_id', id).eq('job_type', 'company_research').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('research_sources').select('id,url,title,source_type,captured_at,metadata').eq('project_id', id).order('captured_at', { ascending: false }).limit(8),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const approved = profile?.status === 'approved'

  return (
    <div className="project-page">
      <section className="page-header compact">
        <div>
          <div className="eyebrow">COMPANY INTELLIGENCE</div>
          <h1>Here’s what Riseklix thinks this business actually does.</h1>
          <p>Company intelligence is versioned and approved before buyer situations are generated. Research evidence stays separate from user-confirmed facts, and uncertainty remains visible instead of being silently filled in.</p>
        </div>
      </section>

      {error && <div className="form-alert error">{error}</div>}
      {message && <div className="form-alert success">{message}</div>}

      <section className="research-placeholder live-research">
        <div>
          <div className="eyebrow">FIRST-PARTY RESEARCH</div>
          <h2>{job?.status === 'succeeded' ? 'Homepage evidence captured.' : job?.status === 'failed' ? 'The latest crawl needs attention.' : 'Start with the company’s own evidence.'}</h2>
          <p>The first live research stage fetches the company homepage, records a snapshot hash, extracts a bounded text sample, and preserves the source before any AI interpretation is allowed to use it.</p>
          {job && <div className="job-line"><span>{job.status}</span><span>{job.stage ?? 'queued'}</span><span>{job.progress}%</span></div>}
        </div>
        <form action={runCompanyResearch}>
          <input type="hidden" name="project_id" value={id} />
          <button type="submit">{job?.status === 'succeeded' ? 'Refresh first-party capture' : 'Run company research'}</button>
        </form>
      </section>

      {!!sources?.length && (
        <section className="evidence-panel">
          <div className="eyebrow">CAPTURED EVIDENCE</div>
          <div className="evidence-list">
            {sources.map((source) => {
              const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata) ? source.metadata as Record<string, unknown> : {}
              return (
                <article key={source.id}>
                  <div>
                    <span>{source.source_type.replaceAll('_', ' ')}</span>
                    <strong>{source.title || source.url}</strong>
                    <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                  </div>
                  <small>{source.captured_at ? new Date(source.captured_at).toLocaleString() : 'Not timestamped'} · {typeof metadata.http_status === 'number' ? `HTTP ${metadata.http_status}` : 'status unknown'}</small>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {profile && (
        <section className="profile-review-section">
          <div className="review-heading">
            <div><div className="eyebrow">HUMAN APPROVAL GATE</div><h2>Review the commercial context before we generate Buyer Intents.</h2></div>
            <span className={`profile-state ${approved ? 'approved' : ''}`}>{profile.status}</span>
          </div>
          <p className="review-intro">One line per item. Saving an already-approved profile moves it back to draft review so a changed business premise can never silently rewrite an existing benchmark.</p>

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
            <div className="profile-form-actions full">
              <button type="submit">Save reviewed profile</button>
            </div>
          </form>

          <form action={approveCompanyProfile} className="approval-panel">
            <input type="hidden" name="project_id" value={id} />
            <div><div className="eyebrow">APPROVAL</div><strong>{approved ? 'Company context approved.' : 'Only approve when the business context is materially correct.'}</strong><p>Approval unlocks Buyer Intent generation. It does not certify every public claim as true; evidence strength remains attached separately.</p></div>
            <button type="submit" disabled={approved}>{approved ? 'Approved' : 'Approve + unlock Buyer Situations'}</button>
          </form>
        </section>
      )}

      <section className="next-step-panel">
        <div className="eyebrow">NEXT RESEARCH STAGE</div>
        <h2>{approved ? 'Generate commercial Buyer Intent candidates from the approved profile.' : 'Finish the Company Intelligence review.'}</h2>
        <p>{approved ? 'The next engine will combine buyer, job, constraint, required capability, geography and commercial model before producing any prompt wording.' : 'Riseklix will not treat prompt generation as ground truth until this company premise is approved.'}</p>
      </section>
    </div>
  )
}
