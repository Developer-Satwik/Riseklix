import { withSupabase } from 'npm:@supabase/server'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

type RequestBody = { project_id?: string; benchmark_id?: string }

async function continueAutopilot(req: Request, projectId: string) {
  const authHeader = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authHeader || !supabaseUrl) return

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: authHeader,
  }
  if (anonKey) headers.apikey = anonKey

  try {
    await fetch(supabaseUrl + '/functions/v1/auto-analysis-runner', {
      method: 'POST',
      headers,
      body: JSON.stringify({ project_id: projectId }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    // Durable benchmark state allows a later retry.
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    const benchmarkId = body.benchmark_id?.trim()
    if (!projectId || !benchmarkId) return json({ error: 'project_id and benchmark_id are required' }, 400)

    const [{ data: project }, { data: benchmark }, { data: activeJob }] = await Promise.all([
      ctx.supabase.from('projects').select('id,workspace_id').eq('id', projectId).single(),
      ctx.supabase.from('benchmarks').select('id,status').eq('id', benchmarkId).eq('project_id', projectId).single(),
      ctx.supabase
        .from('research_jobs')
        .select('id,status,stage,progress,created_at')
        .eq('project_id', projectId)
        .eq('job_type', 'observation_collection')
        .eq('stage', 'multi_surface_observation')
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (!project || !benchmark) return json({ error: 'Project or benchmark not found' }, 404)
    if (benchmark.status === 'complete') return json({ complete: true, message: 'All enabled observation surfaces are already complete.' })
    if (activeJob) {
      return json({
        pending: true,
        job: activeJob,
        message: 'Approved questions are already running across the configured AI surfaces.',
      }, 202)
    }

    const authHeader = req.headers.get('Authorization')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!authHeader || !supabaseUrl) return json({ error: 'Edge Function runtime is missing authenticated invocation context' }, 500)

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      created_by: userId,
      job_type: 'observation_collection',
      status: 'running',
      progress: 1,
      stage: 'multi_surface_observation',
      idempotency_key: 'multi-surface:' + benchmark.id + ':' + crypto.randomUUID(),
      input: { benchmark_id: benchmark.id, mode: 'all_enabled_surfaces' },
      started_at: new Date().toISOString(),
    }).select('id').single()

    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start multi-surface observation job' }, 400)

    const task = (async () => {
      const providerPlans = [
        { provider: 'openai', functionName: 'openai-observation-runner', maxRuns: 2 },
        { provider: 'google', functionName: 'provider-observation-runner', maxRuns: 2 },
        { provider: 'anthropic', functionName: 'provider-observation-runner', maxRuns: 2 },
        { provider: 'perplexity', functionName: 'provider-observation-runner', maxRuns: 2 },
      ] as const

      const surfaceRows = await ctx.supabase
        .from('benchmark_surfaces')
        .select('id,provider,status,enabled,expected_runs,captured_runs,error_runs,metadata')
        .eq('benchmark_id', benchmark.id)
        .eq('enabled', true)

      const configured = surfaceRows.data ?? []
      const runnablePlans = providerPlans.filter((plan) =>
        configured.some((surface) => {
          if (surface.provider !== plan.provider || surface.status === 'complete' || !surface.enabled) return false
          const failures = Number(record(surface.metadata).orchestration_failures || 0)
          return failures < 2
        })
      )

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      }
      if (anonKey) headers.apikey = anonKey

      const results = await Promise.all(runnablePlans.map(async (plan) => {
        let lastPayload: Record<string, unknown> = {}
        let error: string | null = null

        for (let batch = 0; batch < 1; batch++) {
          try {
            const payload = plan.provider === 'openai'
              ? { project_id: project.id, benchmark_id: benchmark.id, max_runs: plan.maxRuns }
              : { project_id: project.id, benchmark_id: benchmark.id, provider: plan.provider, max_runs: plan.maxRuns }

            const response = await fetch(supabaseUrl + '/functions/v1/' + plan.functionName, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(110_000),
            })

            let parsed: unknown = {}
            try { parsed = await response.json() } catch {
              parsed = { error: await response.text() }
            }
            lastPayload = record(parsed)

            if (!response.ok || lastPayload.error) {
              error = String(lastPayload.message || lastPayload.error || ('HTTP ' + response.status))
              const surface = configured.find((item) => item.provider === plan.provider)
              if (surface) {
                const failures = Number(record(surface.metadata).orchestration_failures || 0) + 1
                await ctx.supabase.from('benchmark_surfaces').update({
                  status: failures >= 2 ? 'failed' : surface.status,
                  metadata: {
                    ...record(surface.metadata),
                    orchestration_failures: failures,
                    last_error: error,
                    last_error_at: new Date().toISOString(),
                  },
                  updated_at: new Date().toISOString(),
                }).eq('id', surface.id)
              }
              break
            }

            const batchCaptured = Number(lastPayload.captured ?? 0)
            const batchFailed = Number(lastPayload.failed ?? 0)
            if (batchFailed > 0 && batchCaptured === 0) {
              const surface = configured.find((item) => item.provider === plan.provider)
              const latestError = await ctx.supabase
                .from('observation_runs')
                .select('error_message')
                .eq('benchmark_id', benchmark.id)
                .eq('provider', plan.provider)
                .eq('run_status', 'error')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
              error = latestError.data?.error_message || 'Every observation in the provider batch failed.'
              if (surface) {
                await ctx.supabase.from('benchmark_surfaces').update({
                  status: 'failed',
                  metadata: {
                    ...record(surface.metadata),
                    orchestration_failures: Math.max(1, Number(record(surface.metadata).orchestration_failures || 0)),
                    last_error: error,
                    last_error_at: new Date().toISOString(),
                    automatic_retry_blocked: true,
                  },
                  updated_at: new Date().toISOString(),
                }).eq('id', surface.id)
              }
              break
            }

            if (lastPayload.surface_complete === true || lastPayload.benchmark_complete === true) break
            if (Number(lastPayload.remaining ?? 0) <= 0) break
          } catch (caught) {
            error = caught instanceof Error ? caught.message : 'Unknown observation orchestration error'
            const surface = configured.find((item) => item.provider === plan.provider)
            if (surface) {
              const failures = Number(record(surface.metadata).orchestration_failures || 0) + 1
              await ctx.supabase.from('benchmark_surfaces').update({
                status: failures >= 2 ? 'failed' : surface.status,
                metadata: {
                  ...record(surface.metadata),
                  orchestration_failures: failures,
                  last_error: error,
                  last_error_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              }).eq('id', surface.id)
            }
            break
          }
        }

        return { provider: plan.provider, payload: lastPayload, error }
      }))

      const refreshed = await ctx.supabase
        .from('benchmark_surfaces')
        .select('provider,status,expected_runs,captured_runs,error_runs')
        .eq('benchmark_id', benchmark.id)
        .eq('enabled', true)

      const surfaces = refreshed.data ?? []
      const expected = surfaces.reduce((sum, surface) => sum + Number(surface.expected_runs || 0), 0)
      const captured = surfaces.reduce((sum, surface) => sum + Number(surface.captured_runs || 0), 0)
      const allTerminal = surfaces.length > 0 && surfaces.every((surface) => ['complete','failed'].includes(surface.status))
      const anyComplete = surfaces.some((surface) => surface.status === 'complete')
      const complete = allTerminal && anyComplete
      const allFailed = allTerminal && !anyComplete
      const progress = expected ? Math.min(100, Math.max(1, Math.round((captured / expected) * 100))) : 1

      if (complete || allFailed) {
        await ctx.supabase.from('benchmarks').update({
          status: complete ? 'complete' : 'failed',
          completed_at: new Date().toISOString(),
        }).eq('id', benchmark.id)
      }

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded',
        progress,
        stage: complete ? 'multi_surface_complete' : allFailed ? 'multi_surface_failed' : 'multi_surface_batch_complete',
        output: { benchmark_id: benchmark.id, results, expected, captured, complete, all_failed: allFailed },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      // Observation completion is not analysis completion. The WHY layer still
      // needs to run before Autopilot can mark the project complete.
      await continueAutopilot(req, project.id)
    })().catch(async (error) => {
      const message = error instanceof Error ? error.message : 'Unknown multi-surface observation error'
      await ctx.supabase.from('research_jobs').update({
        status: 'failed',
        stage: 'multi_surface_observation_failed',
        error: { message },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)
    })

    EdgeRuntime.waitUntil(task)

    return json({
      pending: true,
      job: { id: job.id, status: 'running', stage: 'multi_surface_observation' },
      message: 'Approved questions are now running across every configured AI surface.',
    }, 202)
  }),
}

export default handler
