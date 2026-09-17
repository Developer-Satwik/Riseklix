import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id,name,domain,market,status,updated_at')
    .order('updated_at', { ascending: false })

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div><div className="eyebrow">WORKSPACE</div><h1>Your commercial-discovery projects.</h1><p>Each project keeps company context, buyer situations, observations, findings and rechecks together.</p></div>
        <Link href="/projects/new" className="primary-link">New analysis</Link>
      </header>
      {error && <div className="form-alert error">Could not load projects: {error.message}</div>}
      <div className="project-grid">
        {projects?.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}/overview`} className="project-card">
            <div className="project-status">{project.status.replaceAll('_', ' ')}</div>
            <h2>{project.name}</h2>
            <p>{project.domain}</p>
            <footer><span>{project.market}</span><span>Open →</span></footer>
          </Link>
        ))}
      </div>
      {!error && !projects?.length && (
        <div className="empty-state"><h2>No projects yet.</h2><p>Start with one company URL. Riseklix will build the commercial context before it creates buyer situations.</p><Link href="/projects/new" className="primary-link">Create first analysis</Link></div>
      )}
    </div>
  )
}
