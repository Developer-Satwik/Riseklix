import { createClient } from '@/lib/supabase/server'

export default async function CompanyProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()
  const { data: profile } = await supabase.from('company_profile_versions').select('*').eq('project_id', id).eq('is_current', true).single()
  const error = typeof query.error === 'string' ? query.error : null

  const cards = [
    ['What you sell', profile?.products],
    ['How customers buy', profile?.services],
    ['Who appears to buy', profile?.audiences],
    ['Where you operate', profile?.geographies],
    ['What we are less certain about', profile?.uncertainty],
  ] as const

  return (
    <div className="project-page">
      <section className="page-header compact"><div><div className="eyebrow">COMPANY INTELLIGENCE</div><h1>Here’s what Riseklix thinks this business actually does.</h1><p>Company intelligence is versioned and approved before buyer situations are generated. Sources and uncertainty remain attached to the claims they support.</p></div></section>
      {error && <div className="form-alert error">{error}</div>}
      <div className="profile-summary"><span>{profile?.status ?? 'draft'}</span><h2>{profile?.company_name}</h2><p>{profile?.summary}</p></div>
      <div className="profile-grid">{cards.map(([title, value]) => <section key={title}><div className="eyebrow">{title}</div><pre>{JSON.stringify(value ?? [], null, 2)}</pre></section>)}</div>
      <section className="research-placeholder"><div><div className="eyebrow">RESEARCH PIPELINE</div><h2>Live company research is the next backend milestone.</h2><p>The database, versioning, evidence objects and approval boundary are ready. The research worker will populate this screen from first-party and outside-in evidence.</p></div><button disabled>Run company research — coming next</button></section>
    </div>
  )
}
