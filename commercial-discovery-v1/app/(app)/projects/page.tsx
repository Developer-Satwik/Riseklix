import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

function stageCopy(status: string) {
  if (status === 'draft' || status === 'profile_review') return ['Company Intelligence', 'Confirm what Riseklix learned about the business.']
  if (status === 'intents_review') return ['Buyer Situations', 'Review which commercial situations belong in the benchmark.']
  if (status === 'running') return ['Benchmark running', 'Observation collection is still in progress.']
  if (status === 'complete') return ['Analysis ready', 'Review findings, fixes and longitudinal changes.']
  if (status === 'archived') return ['Archived', 'This project is no longer actively monitored.']
  return ['In progress', 'Continue the research workflow.']
}

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id,name,domain,market,status,updated_at')
    .order('updated_at', { ascending: false })

  const active = projects?.filter((project) => !['complete', 'archived'].includes(project.status)).length ?? 0
  const complete = projects?.filter((project) => project.status === 'complete').length ?? 0

  return (
    <div className="page-wrap workspace-projects-page">
      <header className="workspace-projects-hero">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Your commercial-discovery projects.</h1>
          <p>One company, one evidence chain. Riseklix keeps the business premise, Buyer Situations, observations, WHY findings, implementation and rechecks connected.</p>
        </div>
        <Link href="/projects/new" className="primary-link">New analysis <span aria-hidden="true">+</span></Link>
      </header>

      {error && <div className="form-alert error" role="alert">Could not load projects: {error.message}</div>}

      {!!projects?.length && (
        <>
          <section className="workspace-pulse">
            <div><span>Total companies</span><strong>{projects.length}</strong></div>
            <div><span>Active research</span><strong>{active}</strong></div>
            <div><span>Complete analyses</span><strong>{complete}</strong></div>
          </section>

          <section className="project-list" aria-label="Projects">
            <div className="project-list-head"><span>Company</span><span>Current stage</span><span>Updated</span><span /></div>
            {projects.map((project) => {
              const [stage, description] = stageCopy(project.status)
              return (
                <Link key={project.id} href={'/projects/' + project.id + '/overview'} className="project-list-row">
                  <div className="project-list-company">
                    <span className="project-list-mark" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>
                    <div><strong>{project.name}</strong><small>{project.domain} · {project.market}</small></div>
                  </div>
                  <div className="project-list-stage"><strong>{stage}</strong><small>{description}</small></div>
                  <time>{new Date(project.updated_at).toLocaleDateString()}</time>
                  <span className="project-list-arrow" aria-hidden="true">→</span>
                </Link>
              )
            })}
          </section>
        </>
      )}

      {!error && !projects?.length && (
        <div className="empty-state workspace-empty">
          <div className="eyebrow">NO PROJECTS YET</div>
          <h2>Start with one company URL.</h2>
          <p>Riseklix will research the business before it generates a single Buyer Situation. You review the premise before anything becomes part of a benchmark.</p>
          <Link href="/projects/new" className="primary-link">Create first analysis →</Link>
        </div>
      )}
    </div>
  )
}
