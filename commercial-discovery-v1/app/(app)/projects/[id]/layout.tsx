import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const sections = [
  ['Overview', 'overview'],
  ['Buyer Situations', 'buyer-situations'],
  ['Why', 'why'],
  ['Fixes', 'fixes'],
  ['Recheck', 'recheck'],
  ['Company Profile', 'company-profile'],
] as const

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: project } = await supabase.from('projects').select('id,name,domain,market,status').eq('id', id).single()
  if (!project) notFound()

  return (
    <div className="project-shell">
      <header className="project-topbar">
        <div><small>{project.market}</small><strong>{project.name}</strong><span>{project.domain}</span></div>
        <div className="project-state">{project.status.replaceAll('_', ' ')}</div>
      </header>
      <nav className="project-nav">{sections.map(([label, path]) => <Link key={path} href={`/projects/${id}/${path}`}>{label}</Link>)}</nav>
      {children}
    </div>
  )
}
