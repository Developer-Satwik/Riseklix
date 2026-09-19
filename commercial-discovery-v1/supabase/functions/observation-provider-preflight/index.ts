import { withSupabase } from 'npm:@supabase/server'
import { MIN_USABLE_PROVIDERS, observationProviderReadiness } from '../_shared/observation-provider-readiness.ts'

type RequestBody = { project_id?: string }

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const handler = {
  fetch: withSupabase({ auth: ['user','secret'] }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
    const projectId = body.project_id?.trim()
    if (!projectId) return json({ error: 'project_id is required' }, 400)

    const db = ctx.authMode === 'user' ? ctx.supabase : ctx.supabaseAdmin
    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle()
    if (projectError) return json({ error: 'provider_preflight_project_lookup_failed', message: projectError.message }, 400)
    if (!project) return json({ error: 'project_not_found', message: 'Project not found or unavailable to this user.' }, 404)

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
