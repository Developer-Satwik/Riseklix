import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function safeNext(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/projects'
  return value
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNext(request.nextUrl.searchParams.get('next'))
  const redirectTo = request.nextUrl.clone()

  if (!code) {
    redirectTo.pathname = '/login'
    redirectTo.search = ''
    redirectTo.searchParams.set('error', 'Authentication callback was missing a verification code')
    return NextResponse.redirect(redirectTo)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    redirectTo.pathname = '/login'
    redirectTo.search = ''

    const message = error?.message || 'Could not complete sign in'
    const friendlyMessage = /pkce|code verifier/i.test(message)
      ? 'We could not finish social sign-in because the secure browser sign-in state was missing. Start again from the same Riseklix tab and domain.'
      : message

    redirectTo.searchParams.set('error', friendlyMessage)
    return NextResponse.redirect(redirectTo)
  }

  const metadata = data.user.user_metadata ?? {}
  await supabase.from('profiles').upsert({
    id: data.user.id,
    display_name: metadata.full_name || metadata.name || data.user.email?.split('@')[0] || null,
    avatar_url: metadata.avatar_url || metadata.picture || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id', ignoreDuplicates: false })

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', data.user.id)
    .maybeSingle()

  redirectTo.search = ''
  redirectTo.pathname = profile?.onboarding_completed_at
    ? (next === '/onboarding' ? '/projects' : next)
    : '/onboarding'

  return NextResponse.redirect(redirectTo)
}
