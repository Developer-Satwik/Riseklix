import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AnalysisDeleteControl } from '@/components/analysis-delete-control'

function stageCopy(status: string) {
  if (status === 'draft' || status === 'profile_review') return ['Company Intelligence', 'Confirm what Riseklix learned about the business.']
  if (status === 'intents_review') return ['Buyer Situations', 'Review which commercial situations belong in the benchmark.']
  if (status === 'running') return ['Benchmark running', 'Observation collection is still in progress.']
  if (status === 'complete') return ['Analysis ready', 'Review findings, fixes and longitudinal changes.']
  if (status === 'archived') return ['Archived', 'This project is no longer actively monitored.']
  return ['In progress', 'Continue the research workflow.']
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const pageError = typeof params.error === 'string' ? params.error : null
  const pageMessage = typeof params.message === 'string' ? params.message : null
  const supabase = await createClient()
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id,workspace_id,name,domain,market,status,analysis_mode,updated_at')
    .order('updated_at', { ascending: false })

  const active = projects?.filter((project) => !['complete', 'archived'].includes(project.status)).length ?? 0
  const complete = projects?.filter((project) => project.status === 'complete').length ?? 0

  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  const { data: memberships } = typeof userId === 'string'
    ? await supabase
      .from('workspace_members')
      .select('workspace_id,role')
      .eq('user_id', userId)
    : { data: [] }

  const ownerWorkspaceIds = new Set(
    (memberships ?? []).filter((item) => item.role === 'owner').map((item) => item.workspace_id),
  )

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

      {pageError && <div className="form-alert error" role="alert">{pageError}</div>}
      {pageMessage && <div className="form-alert success" role="status" aria-live="polite">{pageMessage}</div>}
      {error && <div className="form-alert error" role="alert">Could not load projects: {error.message}</div>}

      {!!projects?.length && (
        <>
          <section className="workspace-pulse">
            <div><span>Total companies</span><strong>{projects.length}</strong></div>
            <div><span>Active research</span><strong>{active}</strong></div>
            <div><span>Complete analyses</span><strong>{complete}</strong></div>
          </section>

          <section className="project-list" aria-label="Projects">
            <div className="project-list-head"><span>Company</span><span>Current stage</span><span>Updated</span><span aria-hidden="true" /></div>
            {projects.map((project) => {
              const [stage, description] = stageCopy(project.status)
              const projectHref = project.analysis_mode === 'autopilot'
                ? project.status === 'complete'
                  ? '/projects/' + project.id + '/report'
                  : project.status === 'running'
                    ? '/projects/' + project.id + '/processing'
                    : '/projects/' + project.id + '/overview'
                : '/projects/' + project.id + '/overview'
              return (
                <div key={project.id} className="project-list-row">
                  <Link href={projectHref} className="project-list-row-main">
                    <div className="project-list-company">
                      <div><strong>{project.name}</strong><small>{project.domain} · {project.market}</small></div>
                    </div>
                    <div className="project-list-stage"><strong>{stage}</strong><small>{description}</small></div>
                    <time>{new Date(project.updated_at).toLocaleDateString()}</time>
                  </Link>
                  {ownerWorkspaceIds.has(project.workspace_id) && (
                    <div className="project-list-actions">
                      <AnalysisDeleteControl projectId={project.id} projectName={project.name} variant="icon" />
                    </div>
                  )}
                </div>
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
