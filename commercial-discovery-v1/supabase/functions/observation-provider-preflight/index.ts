import { withSupabase } from 'npm:@supabase/server'
import { MIN_USABLE_PROVIDERS, observationProviderReadiness } from '../_shared/observation-provider-readiness.ts'

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const handler = {
  fetch: withSupabase({ auth: ['user','secret'] }, async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const readiness = observationProviderReadiness()
    const configured = readiness.filter((item) => item.configured)

    return json({
      ready: configured.length >= MIN_USABLE_PROVIDERS,
      minimum_required: MIN_USABLE_PROVIDERS,
      configured_provider_count: configured.length,
      configured_providers: configured.map((item) => item.provider),
      providers: readiness.map((item) => ({
        provider: item.provider,
        display_name: item.displayName,
        configured: item.configured,
      })),
    })
  }),
}

export default handler
