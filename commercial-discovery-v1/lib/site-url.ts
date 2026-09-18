import { headers } from 'next/headers'

export async function getSiteUrl(path = '') {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const proto = requestHeaders.get('x-forwarded-proto') ?? (host?.includes('localhost') ? 'http' : 'https')
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  const base = host ? `${proto}://${host}` : configured || 'http://localhost:3000'
  const suffix = !path ? '' : path.startsWith('/') ? path : '/' + path
  return base + suffix
}
