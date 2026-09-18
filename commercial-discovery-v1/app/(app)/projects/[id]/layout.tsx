import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProjectNav } from '@/components/project-nav'
import { AnalysisDeleteControl } from '@/components/analysis-delete-control'

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: project } = await supabase.from('projects').select('id,workspace_id,name,domain,market,status').eq('id', id).single()
  if (!project) notFound()

  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  const { data: membership } = typeof userId === 'string'
    ? await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', project.workspace_id)
      .eq('user_id', userId)
      .maybeSingle()
    : { data: null }

  const canDelete = membership?.role === 'owner'

  return (
    <div className="project-shell">
      <header className="project-topbar">
        <div className="project-identity">
          <Link href="/projects" className="project-back" aria-label="Back to projects">←</Link>
          <div>
            <small>{project.market}</small>
            <strong>{project.name}</strong>
            <span>{project.domain}</span>
          </div>
        </div>
        <div className="project-topbar-actions">
          <div className="project-state"><i aria-hidden="true" />{project.status.replaceAll('_', ' ')}</div>
          {canDelete && <AnalysisDeleteControl projectId={id} projectName={project.name} variant="icon" />}
        </div>
      </header>
      <ProjectNav projectId={id} />
      {children}
    </div>
  )
}
