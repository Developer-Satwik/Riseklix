import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const user = data?.claims
  if (error || !user?.sub) redirect('/login')

  const [{ data: profile }, { data: workspace }] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name,avatar_url,onboarding_completed_at')
      .eq('id', user.sub)
      .maybeSingle(),
    supabase
      .from('workspaces')
      .select('name')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (!profile?.onboarding_completed_at) redirect('/onboarding')

  return (
    <div className="app-frame">
      <WorkspaceSidebar
        email={typeof user.email === 'string' ? user.email : 'Signed in'}
        displayName={profile.display_name || 'Account'}
        organization={workspace?.name || 'Workspace'}
      />
      <main className="workspace-main">{children}</main>
    </div>
  )
}
