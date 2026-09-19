import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function safeNext(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/projects'
  return value
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null
  const next = safeNext(request.nextUrl.searchParams.get('next'))
  const redirectTo = request.nextUrl.clone()
  redirectTo.search = ''

  if (tokenHash && type) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

    if (!error && data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_completed_at')
        .eq('id', data.user.id)
        .maybeSingle()

      redirectTo.pathname = profile?.onboarding_completed_at
        ? (next === '/onboarding' ? '/projects' : next)
        : '/onboarding'
      return NextResponse.redirect(redirectTo)
    }
  }

  redirectTo.pathname = '/login'
  redirectTo.searchParams.set('error', 'Confirmation link is invalid or expired')
  return NextResponse.redirect(redirectTo)
}
