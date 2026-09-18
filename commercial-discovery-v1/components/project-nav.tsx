'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const stages = [
  ['01', 'Overview', 'overview'],
  ['02', 'Buyer Situations', 'buyer-situations'],
  ['03', 'Why', 'why'],
  ['04', 'Fixes', 'fixes'],
  ['05', 'Recheck', 'recheck'],
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
      <Link
        href={`/projects/${projectId}/company-profile`}
        className={pathname.includes('/company-profile') ? 'project-profile-link active' : 'project-profile-link'}
        aria-current={pathname.includes('/company-profile') ? 'page' : undefined}
      >
        Company profile
      </Link>
    </div>
  )
}
