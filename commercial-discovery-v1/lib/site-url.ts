import { headers } from 'next/headers'

export async function getSiteUrl(path = '') {
  const suffix = !path ? '' : path.startsWith('/') ? path : '/' + path

  // In production, always trust the explicitly configured public origin.
  // Serverless platforms can expose an internal Host header such as localhost
  // or a function hostname, which must never become an OAuth redirect target.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (configured) return configured + suffix

  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const proto = requestHeaders.get('x-forwarded-proto') ?? (host?.includes('localhost') ? 'http' : 'https')
  const base = host ? `${proto}://${host}` : 'http://localhost:3000'

  return base + suffix
}
