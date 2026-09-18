'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const stages = [
  ['01', 'Overview', 'overview'],
  ['02', 'Buyer Situations', 'buyer-situations'],
  ['03', 'Test', 'test'],
  ['04', 'Why', 'why'],
  ['05', 'Fixes', 'fixes'],
  ['06', 'Recheck', 'recheck'],
] as const

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname()

  return (
    <div className="project-journey-shell">
      <nav className="project-journey" aria-label="Project workflow">
        {stages.map(([number, label, path]) => {
          const href = `/projects/${projectId}/${path}`
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link key={path} href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
              <span className="journey-number">{number}</span>
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="project-utility-nav">
        <Link
          href={`/projects/${projectId}/method`}
          className={pathname.includes('/method') ? 'project-profile-link active' : 'project-profile-link'}
          aria-current={pathname.includes('/method') ? 'page' : undefined}
        >
          Method
        </Link>
        <Link
          href={`/projects/${projectId}/company-profile`}
          className={pathname.includes('/company-profile') ? 'project-profile-link active' : 'project-profile-link'}
          aria-current={pathname.includes('/company-profile') ? 'page' : undefined}
        >
          Company profile
        </Link>
      </div>
    </div>
  )
}
