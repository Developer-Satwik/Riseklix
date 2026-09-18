'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ProfileMenu } from '@/components/profile-menu'

const SIDEBAR_STORAGE_KEY = 'riseklix.sidebar.collapsed'

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M7 3v14" />
      {collapsed ? <path d="m10.5 7.5 2.5 2.5-2.5 2.5" /> : <path d="m13 7.5-2.5 2.5 2.5 2.5" />}
    </svg>
  )
}

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
  const [collapsed, setCollapsed] = useState(false)
  const projectsActive = pathname === '/projects' || pathname.startsWith('/projects/')
  const newActive = pathname === '/projects/new'

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    const nextCollapsed = stored === 'true'
    document.documentElement.dataset.sidebarCollapsed = String(nextCollapsed)

    const frame = window.requestAnimationFrame(() => setCollapsed(nextCollapsed))
    return () => {
      window.cancelAnimationFrame(frame)
      delete document.documentElement.dataset.sidebarCollapsed
    }
  }, [])

  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
    document.documentElement.dataset.sidebarCollapsed = String(next)
  }

  return (
    <aside className="workspace-sidebar" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar-header">
        <Link href="/projects" className="wordmark brand-wordmark sidebar-logo-link" aria-label="Riseklix">
          <span className="brand-mark" aria-hidden="true" />
          <strong>RISEKLIX</strong>
        </Link>
        <button
          type="button"
          className="sidebar-collapse-button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
        <div className="sidebar-product">Commercial Discovery</div>
      </div>

      <div className="sidebar-workspace">
        <span>Organization</span>
        <strong title={organization}>{organization}</strong>
      </div>

      <nav aria-label="Workspace">
        <Link
          href="/projects"
          className={projectsActive && !newActive ? 'active' : ''}
          aria-label="Projects"
          title={collapsed ? 'Projects' : undefined}
        >
          <span className="sidebar-nav-dot" aria-hidden="true" />
          <span className="sidebar-nav-label">Projects</span>
        </Link>
        <Link
          href="/projects/new"
          className={newActive ? 'active' : ''}
          aria-label="New analysis"
          title={collapsed ? 'New analysis' : undefined}
        >
          <span className="sidebar-nav-plus" aria-hidden="true">+</span>
          <span className="sidebar-nav-label">New analysis</span>
        </Link>
      </nav>

      <div className="sidebar-principle">
        <span>Product rule</span>
        <p>Never make the customer do analysis Riseklix can do for them.</p>
      </div>

      <div className="sidebar-bottom">
        <ProfileMenu
          email={email}
          displayName={displayName}
          organization={organization}
        />
      </div>
    </aside>
  )
}
