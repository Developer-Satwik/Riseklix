import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const user = data?.claims
  if (error || !user?.sub) redirect('/login')

  return (
    <div className="app-frame">
      <aside className="workspace-sidebar">
        <Link href="/projects" className="wordmark"><span>R</span> RISEKLIX</Link>
        <nav>
          <Link href="/projects">Projects</Link>
          <Link href="/projects/new">New analysis</Link>
        </nav>
        <div className="sidebar-bottom">
          <small>{typeof user.email === 'string' ? user.email : 'Signed in'}</small>
          <form action="/auth/signout" method="post"><button>Sign out</button></form>
        </div>
      </aside>
      <main className="workspace-main">{children}</main>
    </div>
  )
}
