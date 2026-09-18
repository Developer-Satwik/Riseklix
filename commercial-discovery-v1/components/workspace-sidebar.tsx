'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function WorkspaceSidebar({
  email,
  displayName,
  organization,
}: {
  email: string
  displayName: string
  organization: string
}) {
  const pathname = usePathname()
  const projectsActive = pathname === '/projects' || pathname.startsWith('/projects/')
  const newActive = pathname === '/projects/new'
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'R'

  return (
    <aside className="workspace-sidebar">
      <div>
        <Link href="/projects" className="wordmark brand-wordmark sidebar-logo-link" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="sidebar-product">Commercial Discovery</div>
      </div>

      <div className="sidebar-workspace">
        <span>Organization</span>
        <strong title={organization}>{organization}</strong>
      </div>

      <nav aria-label="Workspace">
        <Link href="/projects" className={projectsActive && !newActive ? 'active' : ''}>
          <span className="sidebar-nav-dot" aria-hidden="true" />
          Projects
        </Link>
        <Link href="/projects/new" className={newActive ? 'active' : ''}>
          <span className="sidebar-nav-plus" aria-hidden="true">+</span>
          New analysis
        </Link>
      </nav>

      <div className="sidebar-principle">
        <span>Product rule</span>
        <p>Never make the customer do analysis Riseklix can do for them.</p>
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <span className="sidebar-avatar" aria-hidden="true">{initials}</span>
          <div>
            <strong>{displayName}</strong>
            <small title={email}>{email}</small>
          </div>
        </div>
        <form action="/auth/signout" method="post"><button>Sign out</button></form>
      </div>
    </aside>
  )
}
