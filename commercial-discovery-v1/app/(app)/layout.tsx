import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const user = data?.claims
  if (error || !user?.sub) redirect('/login')

  return (
    <div className="app-frame">
      <WorkspaceSidebar email={typeof user.email === 'string' ? user.email : 'Signed in'} />
      <main className="workspace-main">{children}</main>
    </div>
  )
}
