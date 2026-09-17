import { createClient } from '@/lib/supabase/server'
import { runCompanyResearch } from './actions'

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

  const cards = [
    ['What you sell', profile?.products],
    ['How customers buy', profile?.services],
    ['Who appears to buy', profile?.audiences],
    ['Where you operate', profile?.geographies],
    ['What we are less certain about', profile?.uncertainty],
  ] as const

  return (
    <div className="project-page">
      <section className="page-header compact">
        <div>
          <div className="eyebrow">COMPANY INTELLIGENCE</div>
          <h1>Here’s what Riseklix thinks this business actually does.</h1>
          <p>Company intelligence is versioned and approved before buyer situations are generated. Sources and uncertainty remain attached to the claims they support.</p>
        </div>
      </section>

      {error && <div className="form-alert error">{error}</div>}
      {message && <div className="form-alert success">{message}</div>}

      <div className="profile-summary">
        <span>{profile?.status ?? 'draft'}</span>
        <h2>{profile?.company_name}</h2>
        <p>{profile?.summary}</p>
      </div>

      <section className="research-placeholder live-research">
        <div>
          <div className="eyebrow">FIRST-PARTY RESEARCH</div>
          <h2>{job?.status === 'succeeded' ? 'Homepage evidence captured.' : job?.status === 'failed' ? 'The latest crawl needs attention.' : 'Start with the company’s own evidence.'}</h2>
          <p>The first live research stage fetches the company homepage, records a source snapshot hash, extracts a bounded text sample, and keeps the raw evidence separate from any future AI interpretation.</p>
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
                  <div><span>{source.source_type.replaceAll('_', ' ')}</span><strong>{source.title || source.url}</strong><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div>
                  <small>{source.captured_at ? new Date(source.captured_at).toLocaleString() : 'Not timestamped'} · {typeof metadata.http_status === 'number' ? `HTTP ${metadata.http_status}` : 'status unknown'}</small>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <div className="profile-grid">
        {cards.map(([title, value]) => <section key={title}><div className="eyebrow">{title}</div><pre>{JSON.stringify(value ?? [], null, 2)}</pre></section>)}
      </div>

      <section className="next-step-panel">
        <div className="eyebrow">NEXT RESEARCH STAGE</div>
        <h2>Turn captured evidence into a reviewable Company Intelligence Profile.</h2>
        <p>The next worker will crawl a controlled set of first-party pages, search outside-in sources, extract claims with provenance, flag uncertainty, and only then generate Buyer Intent candidates.</p>
      </section>
    </div>
  )
}
