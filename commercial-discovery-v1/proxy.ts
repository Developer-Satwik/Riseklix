import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const isAuthFallbackPath = request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/login'

  // Defensive recovery for OAuth providers/Supabase falling back to the Site URL
  // instead of the configured PKCE callback. Without this, a valid auth code can
  // land on / or /login and never be exchanged for a session.
  if (code && isAuthFallbackPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/callback'
    url.search = ''
    url.searchParams.set('code', code)
    return NextResponse.redirect(url)
  }

  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
