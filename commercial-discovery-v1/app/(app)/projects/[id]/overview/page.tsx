import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [{ data: project }, { data: intents }, { data: findings }, { data: blueprints }, { data: benchmark }] = await Promise.all([
    supabase.from('projects').select('name,domain,market,status').eq('id', id).single(),
    supabase.from('buyer_intents').select('id,status,priority').eq('project_id', id),
    supabase.from('findings').select('id,title:observed,severity,decision').eq('project_id', id).limit(5),
    supabase.from('blueprints').select('id,status').eq('project_id', id),
    supabase.from('benchmarks').select('id,status,benchmark_type,completed_at').eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const approved = intents?.filter((intent) => intent.status === 'approved').length ?? 0
  const fixes = findings?.filter((finding) => finding.decision === 'fix').length ?? 0

  return (
    <div className="project-page">
      <section className="project-hero">
        <div className="eyebrow">WHAT SHOULD I KNOW?</div>
        <h1>{benchmark?.status === 'complete' ? `${project?.name} has ${fixes} issues worth attention.` : 'Build the company context before we test discovery.'}</h1>
        <p>{benchmark?.status === 'complete' ? 'Riseklix has enough evidence to prioritize what deserves action, what needs investigation and what should simply be monitored.' : 'The first milestone is an approved Company Intelligence Profile. No prompt or competitor set should be treated as ground truth before that.'}</p>
        <Link href={benchmark ? `/projects/${id}/buyer-situations` : `/projects/${id}/company-profile`} className="primary-link">{benchmark ? 'Review buyer situations' : 'Review company profile'} →</Link>
      </section>
      <div className="overview-metrics">
        <div><span>Approved buyer situations</span><strong>{approved}</strong></div>
        <div><span>Findings worth fixing</span><strong>{fixes}</strong></div>
        <div><span>Active fixes</span><strong>{blueprints?.filter((item) => item.status !== 'verified').length ?? 0}</strong></div>
        <div><span>Latest benchmark</span><strong>{benchmark ? benchmark.status : 'Not run'}</strong></div>
      </div>
      <section className="next-step-panel"><div className="eyebrow">NEXT BEST ACTION</div><h2>{project?.status === 'draft' ? 'Run and approve Company Intelligence.' : 'Continue the research workflow.'}</h2><p>Riseklix should always tell the user what the next decision is instead of dropping them into a dashboard graveyard.</p></section>
    </div>
  )
}
