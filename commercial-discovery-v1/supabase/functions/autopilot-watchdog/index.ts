import { withSupabase } from 'npm:@supabase/server'

type WatchdogResult = {
  project_id: string
  action: 'resumed' | 'skipped' | 'failed'
  reason?: string
  stage?: string
  progress?: number
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function defaultSecretKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>
    return keys.default || Object.values(keys)[0] || null
  } catch {
    return null
  }
}

const handler = {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const token = req.headers.get('x-riseklix-watchdog-token')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const verification = await ctx.supabaseAdmin.rpc('verify_autopilot_watchdog_token', {
      p_token: token,
    })
    if (verification.error || verification.data !== true) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const secretKey = defaultSecretKey()
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!secretKey || !supabaseUrl) {
      return json({ error: 'Internal Supabase secret key is unavailable' }, 500)
    }

    const now = new Date()
    const staleCutoff = new Date(now.getTime() - 3 * 60 * 1000).toISOString()

    const { data: staleRuns, error: runError } = await ctx.supabaseAdmin
      .from('autopilot_runs')
      .select('id,project_id,status,stage,progress,step_count,max_steps,api_call_count,max_api_calls,lease_until,last_heartbeat_at,metadata')
      .eq('status', 'running')
      .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${staleCutoff}`)
      .order('updated_at', { ascending: true })
      .limit(3)

    if (runError) return json({ error: runError.message }, 500)
    if (!staleRuns?.length) {
      return json({ ok: true, checked: 0, resumed: 0, results: [] })
    }

    const results: WatchdogResult[] = []

    for (const run of staleRuns) {
      if (run.step_count >= run.max_steps || run.api_call_count >= run.max_api_calls) {
        results.push({
          project_id: run.project_id,
          action: 'skipped',
          reason: 'analysis_guardrail_reached',
          stage: run.stage,
          progress: run.progress,
        })
        continue
      }

      if (run.lease_until && new Date(run.lease_until).getTime() > now.getTime()) {
        results.push({
          project_id: run.project_id,
          action: 'skipped',
          reason: 'active_lease',
          stage: run.stage,
          progress: run.progress,
        })
        continue
      }

      const [{ data: project }, { data: activeJobs }] = await Promise.all([
        ctx.supabaseAdmin
          .from('projects')
          .select('id,analysis_mode,status')
          .eq('id', run.project_id)
          .maybeSingle(),
        ctx.supabaseAdmin
          .from('research_jobs')
          .select('id')
          .eq('project_id', run.project_id)
          .in('status', ['running', 'queued'])
          .limit(1),
      ])

      if (!project || project.analysis_mode !== 'autopilot' || project.status === 'complete') {
        results.push({
          project_id: run.project_id,
          action: 'skipped',
          reason: 'project_not_resumable',
          stage: run.stage,
          progress: run.progress,
        })
        continue
      }

      if (activeJobs?.length) {
        results.push({
          project_id: run.project_id,
          action: 'skipped',
          reason: 'active_research_job',
          stage: run.stage,
          progress: run.progress,
        })
        continue
      }

      try {
        const response = await fetch(supabaseUrl + '/functions/v1/auto-analysis-runner', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: secretKey,
          },
          body: JSON.stringify({ project_id: run.project_id }),
          signal: AbortSignal.timeout(20_000),
        })

        let payload: unknown = {}
        try { payload = await response.json() } catch {
          payload = { error: await response.text() }
        }
        const responseData = record(payload)

        if (!response.ok || responseData.error) {
          const message = String(responseData.message || responseData.error || ('HTTP ' + response.status))
          const metadata = {
            ...record(run.metadata),
            watchdog_last_attempt_at: new Date().toISOString(),
            watchdog_last_error: message,
          }
          await ctx.supabaseAdmin
            .from('autopilot_runs')
            .update({ metadata })
            .eq('id', run.id)

          results.push({
            project_id: run.project_id,
            action: 'failed',
            reason: message,
            stage: run.stage,
            progress: run.progress,
          })
          continue
        }

        const metadata = {
          ...record(run.metadata),
          watchdog_last_attempt_at: new Date().toISOString(),
          watchdog_last_error: null,
        }
        await ctx.supabaseAdmin
          .from('autopilot_runs')
          .update({ metadata })
          .eq('id', run.id)

        results.push({
          project_id: run.project_id,
          action: 'resumed',
          stage: typeof responseData.stage === 'string' ? responseData.stage : run.stage,
          progress: typeof responseData.progress === 'number' ? responseData.progress : run.progress,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown watchdog resume error'
        results.push({
          project_id: run.project_id,
          action: 'failed',
          reason: message,
          stage: run.stage,
          progress: run.progress,
        })
      }
    }

    return json({
      ok: true,
      checked: staleRuns.length,
      resumed: results.filter((item) => item.action === 'resumed').length,
      results,
    })
  }),
}

export default handler
