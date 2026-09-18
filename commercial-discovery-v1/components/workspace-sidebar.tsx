'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ProfileMenu } from '@/components/profile-menu'

const SIDEBAR_STORAGE_KEY = 'riseklix.sidebar.collapsed'

function SidebarIcon({ name }: { name: 'collapse' | 'projects' | 'new' }) {
  if (name === 'projects') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2.2" />
        <path d="M7.25 3.25v13.5" />
        <path d="M10.4 7h3.7M10.4 10h3.7M10.4 13h2.6" />
      </svg>
    )
  }

  if (name === 'new') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3.1v13.8M3.1 10h13.8" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M7 3v14" />
      <path d="m13 7.5-2.5 2.5 2.5 2.5" />
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
  const organizationInitial = organization.trim().charAt(0).toUpperCase() || 'R'

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

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== '\\') return
      event.preventDefault()
      setCollapsed((current) => {
        const next = !current
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
        document.documentElement.dataset.sidebarCollapsed = String(next)
        return next
      })
    }

    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
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
          title={collapsed ? 'Expand sidebar (Ctrl/⌘ + \\)' : 'Collapse sidebar (Ctrl/⌘ + \\)'}
        >
          <SidebarIcon name="collapse" />
        </button>

        <div className="sidebar-product">Commercial Discovery</div>
      </div>

      <div className="sidebar-workspace" title={organization}>
        <span className="sidebar-workspace-mark" aria-hidden="true">{organizationInitial}</span>
        <span className="sidebar-workspace-copy">
          <small>Workspace</small>
          <strong>{organization}</strong>
        </span>
        <span className="sidebar-workspace-state" aria-hidden="true">Beta</span>
      </div>

      <div className="sidebar-section-label">Workspace</div>
      <nav aria-label="Workspace">
        <Link
          href="/projects"
          className={projectsActive && !newActive ? 'active' : ''}
          aria-current={projectsActive && !newActive ? 'page' : undefined}
          aria-label="Projects"
          data-tooltip="Projects"
        >
          <span className="sidebar-nav-icon" aria-hidden="true"><SidebarIcon name="projects" /></span>
          <span className="sidebar-nav-label">Projects</span>
        </Link>

        <Link
          href="/projects/new"
          className={newActive ? 'active' : ''}
          aria-current={newActive ? 'page' : undefined}
          aria-label="New analysis"
          data-tooltip="New analysis"
        >
          <span className="sidebar-nav-icon sidebar-nav-icon-new" aria-hidden="true"><SidebarIcon name="new" /></span>
          <span className="sidebar-nav-label">New analysis</span>
        </Link>
      </nav>

      <div className="sidebar-research-note">
        <span className="sidebar-research-pulse" aria-hidden="true" />
        <span>Evidence-first research</span>
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
