import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProjectNav } from '@/components/project-nav'

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: project } = await supabase.from('projects').select('id,name,domain,market,status').eq('id', id).single()
  if (!project) notFound()

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
        <div className="project-state"><i aria-hidden="true" />{project.status.replaceAll('_', ' ')}</div>
      </header>
      <ProjectNav projectId={id} />
      {children}
    </div>
  )
}
