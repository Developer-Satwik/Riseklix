import { withSupabase } from 'npm:@supabase/server'

type RequestBody = { project_id?: string }

const AUTOPILOT_INTENT_LIMIT = 4
const AUTOPILOT_REPETITIONS = 2
const AUTOPILOT_PROMPT_LIMIT = 12
const MAX_STAGE_FAILURES = 2
const LEASE_SECONDS = 75

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function priorityRank(value: string) {
  return value === 'critical' ? 0 : value === 'high' ? 1 : value === 'medium' ? 2 : 3
}

function configuredSurfaces(project: { id: string; workspace_id: string }, benchmarkId: string, expectedRuns: number) {
  const surfaces: Array<Record<string, unknown>> = []

  if (Deno.env.get('OPENAI_API_KEY')) {
    surfaces.push({
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmarkId,
      provider: 'openai',
      surface: 'openai_responses_web_search',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'OpenAI · free-plan proxy',
        methodology_note: 'OpenAI API observation proxy with web search. Results remain separate from the ChatGPT consumer application.',
        consumer_equivalence: 'approximate',
      },
    })
  }

  if (Deno.env.get('GEMINI_API_KEY')) {
    surfaces.push({
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmarkId,
      provider: 'google',
      surface: 'gemini_generate_content_google_search',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'Gemini · Flash API proxy',
        methodology_note: 'Gemini API with Google Search grounding. Results remain separate from the Gemini consumer application.',
        consumer_equivalence: 'approximate',
      },
    })
  }

  if (Deno.env.get('ANTHROPIC_API_KEY')) {
    surfaces.push({
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmarkId,
      provider: 'anthropic',
      surface: 'anthropic_messages_web_search',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'Claude · Sonnet API proxy',
        methodology_note: 'Anthropic Messages API with web search. Results remain separate from the Claude consumer application.',
        consumer_equivalence: 'approximate',
      },
    })
  }

  if (Deno.env.get('PERPLEXITY_API_KEY')) {
    surfaces.push({
      workspace_id: project.workspace_id,
      project_id: project.id,
      benchmark_id: benchmarkId,
      provider: 'perplexity',
      surface: 'perplexity_sonar',
      model_label: null,
      enabled: true,
      status: 'draft',
      expected_runs: expectedRuns,
      captured_runs: 0,
      error_runs: 0,
      metadata: {
        display_name: 'Perplexity · Sonar API',
        methodology_note: 'Perplexity Sonar web-grounded API surface. Results remain separate from the consumer Standard product.',
        consumer_equivalence: 'approximate',
      },
    })
  }

  return surfaces
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    if (!projectId) return json({ error: 'project_id is required' }, 400)

    const authHeader = req.headers.get('Authorization')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!authHeader || !supabaseUrl) return json({ error: 'Authenticated function context unavailable' }, 500)

    const { data: project, error: projectError } = await ctx.supabase
      .from('projects')
      .select('id,workspace_id,name,market,analysis_mode,primary_language,status')
      .eq('id', projectId)
      .single()

    if (projectError || !project) return json({ error: 'Project not found' }, 404)
    if (project.analysis_mode !== 'autopilot') return json({ skipped: true, stage: 'manual_mode' })

    let { data: run } = await ctx.supabase
      .from('autopilot_runs')
      .select('*')
      .eq('project_id', project.id)
      .maybeSingle()

    if (!run) {
      const created = await ctx.supabase.from('autopilot_runs').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        status: 'running',
        stage: 'waiting_for_company_confirmation',
        progress: 5,
        max_steps: 80,
        max_api_calls: 60,
        metadata: {
          intent_limit: AUTOPILOT_INTENT_LIMIT,
          repetitions: AUTOPILOT_REPETITIONS,
          prompt_limit: AUTOPILOT_PROMPT_LIMIT,
        },
      }).select('*').single()

      if (created.error || !created.data) {
        const retry = await ctx.supabase.from('autopilot_runs').select('*').eq('project_id', project.id).single()
        if (retry.error || !retry.data) return json({ error: created.error?.message ?? 'Could not initialize AI Autopilot state' }, 400)
        run = retry.data
      } else {
        run = created.data
      }
    }

    if (run.status === 'complete') {
      return json({ complete: true, stage: run.stage, progress: run.progress, message: 'AI evaluation is already complete.' })
    }

    if (['paused','failed','cancelled'].includes(run.status)) {
      return json({
        paused: run.status === 'paused',
        stage: run.stage,
        progress: run.progress,
        error: run.last_error || null,
        message: run.last_error || 'AI Autopilot is not currently running.',
      })
    }

    if (run.step_count >= run.max_steps) {
      await ctx.supabase.from('autopilot_runs').update({
        status: 'paused',
        stage: 'guardrail_step_limit',
        last_error: 'AI Autopilot stopped after reaching its maximum workflow-step limit. No further model calls will run until the analysis is explicitly resumed.',
        lease_until: null,
      }).eq('id', run.id)
      return json({ paused: true, stage: 'guardrail_step_limit', progress: run.progress })
    }

    if (run.api_call_count >= run.max_api_calls) {
      await ctx.supabase.from('autopilot_runs').update({
        status: 'paused',
        stage: 'guardrail_api_limit',
        last_error: 'AI Autopilot stopped after reaching its per-analysis API-call limit. No further model calls will run automatically.',
        lease_until: null,
      }).eq('id', run.id)
      return json({ paused: true, stage: 'guardrail_api_limit', progress: run.progress })
    }

    const now = new Date()
    const leaseUntil = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString()
    const claimed = await ctx.supabase
      .from('autopilot_runs')
      .update({
        lease_until: leaseUntil,
        last_heartbeat_at: now.toISOString(),
        step_count: run.step_count + 1,
      })
      .eq('id', run.id)
      .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
      .select('*')
      .maybeSingle()

    if (!claimed.data) {
      return json({
        pending: true,
        stage: run.stage,
        progress: run.progress,
        message: 'AI Autopilot is already processing the next step.',
      }, 202)
    }
    run = claimed.data

    const updateRun = async (values: Record<string, unknown>) => {
      const { data } = await ctx.supabase
        .from('autopilot_runs')
        .update({ last_heartbeat_at: new Date().toISOString(), ...values })
        .eq('id', run.id)
        .select('*')
        .single()
      if (data) run = data
      return run
    }

    const release = async (stage: string, progress: number, extra: Record<string, unknown> = {}) => {
      await updateRun({ stage, progress, lease_until: null, ...extra })
      return json({ pending: progress < 100, stage, progress, ...extra })
    }

    const pause = async (stage: string, progress: number, message: string) => {
      await updateRun({
        status: 'paused',
        stage,
        progress,
        lease_until: null,
        last_error: message,
      })
      return json({ paused: true, stage, progress, message })
    }

    const consumeCall = async () => {
      if (run.api_call_count + 1 > run.max_api_calls) {
        throw new Error('AI Autopilot API-call guardrail reached')
      }
      await updateRun({ api_call_count: run.api_call_count + 1 })
    }

    const invoke = async (name: string, payload: Record<string, unknown>) => {
      await consumeCall()

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      }
      if (anonKey) headers.apikey = anonKey

      const response = await fetch(supabaseUrl + '/functions/v1/' + name, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      })

      let data: unknown = {}
      try { data = await response.json() } catch {
        data = { error: await response.text() }
      }

      if (!response.ok) {
        const payloadRecord = record(data)
        throw new Error(String(payloadRecord.message || payloadRecord.error || ('HTTP ' + response.status)))
      }
      return record(data)
    }

    const stageJobs = async (jobType: string, intentId?: string) => {
      const { data } = await ctx.supabase
        .from('research_jobs')
        .select('id,status,stage,error,input,created_at')
        .eq('project_id', project.id)
        .eq('job_type', jobType)
        .order('created_at', { ascending: false })
        .limit(100)

      return (data ?? []).filter((job) => {
        if (!intentId) return true
        return record(job.input).intent_id === intentId
      })
    }

    const shouldWaitOrPause = async (jobType: string, intentId: string | undefined, stage: string, progress: number) => {
      const jobs = await stageJobs(jobType, intentId)
      const active = jobs.find((job) => job.status === 'running' || job.status === 'queued')
      if (active) return { response: await release(stage, progress, { waiting_on_job_id: active.id }) }

      const failures = jobs.filter((job) => job.status === 'failed')
      if (failures.length >= MAX_STAGE_FAILURES) {
        const latestError = record(failures[0]?.error)
        const message = String(latestError.message || `${stage.replaceAll('_', ' ')} failed twice. Autopilot paused instead of retrying indefinitely.`)
        return { response: await pause(stage + '_paused', progress, message) }
      }
      return { response: null }
    }

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: profile } = await ctx.supabase
      .from('company_profile_versions')
      .select('id,status')
      .eq('project_id', project.id)
      .eq('is_current', true)
      .maybeSingle()

    if (!profile || profile.status !== 'approved') {
      return await release('waiting_for_company_confirmation', 8, {
        message: 'Company Intelligence still needs the one required confirmation.',
      })
    }

    let { data: intents } = await ctx.supabase
      .from('buyer_intents')
      .select('id,status,intent_key,priority,created_at')
      .eq('project_id', project.id)
      .order('created_at')

    if (!intents?.length) {
      const state = await shouldWaitOrPause('intent_generation', undefined, 'generating_buyer_situations', 18)
      if (state.response) return state.response
      try {
        await updateRun({ stage: 'generating_buyer_situations', progress: 18 })
        await invoke('intent-suggestor', { project_id: project.id })
        return await release('generating_buyer_situations', 20)
      } catch (error) {
        return await pause('generating_buyer_situations_paused', 18, error instanceof Error ? error.message : 'Buyer Situation generation failed')
      }
    }

    const candidates = intents.filter((intent) => intent.status === 'candidate')
    if (candidates.length) {
      const ordered = [...candidates].sort((a, b) => {
        const priority = priorityRank(a.priority) - priorityRank(b.priority)
        if (priority !== 0) return priority
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })

      const alreadyApproved = intents.filter((intent) => intent.status === 'approved')
      const slots = Math.max(AUTOPILOT_INTENT_LIMIT - alreadyApproved.length, 0)
      const selected = ordered.slice(0, slots)
      const notSelected = ordered.slice(slots)
      const approvedAt = new Date().toISOString()

      if (selected.length) {
        await ctx.supabase.from('buyer_intents').update({
          status: 'approved',
          approved_by: userId,
          approved_at: approvedAt,
        }).in('id', selected.map((intent) => intent.id))
      }

      if (notSelected.length) {
        await ctx.supabase.from('buyer_intents').update({
          status: 'rejected',
          approved_by: null,
          approved_at: null,
        }).in('id', notSelected.map((intent) => intent.id))
      }

      await ctx.supabase.from('audit_events').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_user_id: userId,
        event_type: 'autopilot_buyer_intents_triaged',
        entity_type: 'project',
        entity_id: project.id,
        payload: {
          selected: selected.length,
          excluded: notSelected.length,
          limit: AUTOPILOT_INTENT_LIMIT,
        },
      })

      const refreshed = await ctx.supabase
        .from('buyer_intents')
        .select('id,status,intent_key,priority,created_at')
        .eq('project_id', project.id)
        .order('created_at')
      intents = refreshed.data ?? intents
    }

    const approvedIntents = (intents ?? []).filter((intent) => intent.status === 'approved').slice(0, AUTOPILOT_INTENT_LIMIT)
    if (!approvedIntents.length) {
      return await pause('no_viable_buyer_situations', 25, 'Autopilot could not identify a Buyer Situation it could safely include in the benchmark.')
    }

    const intentIds = approvedIntents.map((intent) => intent.id)
    const { data: competitors } = await ctx.supabase
      .from('competitor_candidates')
      .select('buyer_intent_id,status,is_current')
      .in('buyer_intent_id', intentIds)
      .eq('is_current', true)
      .eq('status', 'verified')

    const competitorReady = new Set((competitors ?? []).map((item) => item.buyer_intent_id))
    const nextCompetitorIntent = approvedIntents.find((intent) => !competitorReady.has(intent.id))
    if (nextCompetitorIntent) {
      const readyCount = competitorReady.size
      const progress = 30 + Math.round((readyCount / approvedIntents.length) * 22)
      const state = await shouldWaitOrPause('competitor_discovery', nextCompetitorIntent.id, 'researching_competitors', progress)
      if (state.response) return state.response

      try {
        await updateRun({
          stage: 'researching_competitors',
          progress,
          metadata: { ...record(run.metadata), current_intent_id: nextCompetitorIntent.id },
        })
        await invoke('competitor-discovery', {
          project_id: project.id,
          intent_id: nextCompetitorIntent.id,
          regenerate: false,
        })
        return await release('researching_competitors', progress)
      } catch (error) {
        return await pause('researching_competitors_paused', progress, error instanceof Error ? error.message : 'Competitor research failed')
      }
    }

    const { data: promptRows } = await ctx.supabase
      .from('prompt_expressions')
      .select('id,buyer_intent_id,language,mode,status,is_frozen')
      .in('buyer_intent_id', intentIds)

    const candidatePrompts = (promptRows ?? []).filter((prompt) => prompt.status === 'candidate' && !prompt.is_frozen)
    if (candidatePrompts.length) {
      const primaryCandidates = candidatePrompts.filter((prompt) => prompt.language === project.primary_language)
      const otherCandidates = candidatePrompts.filter((prompt) => prompt.language !== project.primary_language)

      if (primaryCandidates.length) {
        await ctx.supabase.from('prompt_expressions').update({ status: 'approved' }).in('id', primaryCandidates.map((prompt) => prompt.id))
      }
      if (otherCandidates.length) {
        await ctx.supabase.from('prompt_expressions').update({ status: 'rejected' }).in('id', otherCandidates.map((prompt) => prompt.id))
      }

      await ctx.supabase.from('audit_events').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_user_id: userId,
        event_type: 'autopilot_questions_triaged',
        entity_type: 'project',
        entity_id: project.id,
        payload: {
          approved_primary_language: primaryCandidates.length,
          excluded_other_languages: otherCandidates.length,
          primary_language: project.primary_language,
        },
      })
    }

    const { data: approvedPrompts } = await ctx.supabase
      .from('prompt_expressions')
      .select('id,buyer_intent_id,language,mode,status,is_frozen')
      .in('buyer_intent_id', intentIds)
      .eq('status', 'approved')
      .eq('language', project.primary_language)

    const modesByIntent = new Map<string, Set<string>>()
    for (const prompt of approvedPrompts ?? []) {
      const modes = modesByIntent.get(prompt.buyer_intent_id) ?? new Set<string>()
      modes.add(prompt.mode)
      modesByIntent.set(prompt.buyer_intent_id, modes)
    }

    const nextPromptIntent = approvedIntents.find((intent) => {
      const modes = modesByIntent.get(intent.id)
      return !modes || !modes.has('unaided') || !modes.has('aided')
    })

    if (nextPromptIntent) {
      const readyCount = approvedIntents.filter((intent) => {
        const modes = modesByIntent.get(intent.id)
        return modes?.has('unaided') && modes?.has('aided')
      }).length
      const progress = 55 + Math.round((readyCount / approvedIntents.length) * 14)
      const state = await shouldWaitOrPause('prompt_generation', nextPromptIntent.id, 'generating_buyer_questions', progress)
      if (state.response) return state.response

      try {
        await updateRun({
          stage: 'generating_buyer_questions',
          progress,
          metadata: { ...record(run.metadata), current_intent_id: nextPromptIntent.id },
        })
        await invoke('prompt-expression-generator', {
          project_id: project.id,
          intent_id: nextPromptIntent.id,
          regenerate: false,
        })
        return await release('generating_buyer_questions', progress)
      } catch (error) {
        return await pause('generating_buyer_questions_paused', progress, error instanceof Error ? error.message : 'Buyer-question generation failed')
      }
    }

    let { data: baseline } = await ctx.supabase
      .from('benchmarks')
      .select('id,status')
      .eq('project_id', project.id)
      .eq('benchmark_type', 'baseline')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!baseline) {
      const selected = (approvedPrompts ?? []).slice(0, AUTOPILOT_PROMPT_LIMIT)
      if (!selected.length) return await pause('no_testable_questions', 70, 'Autopilot has no approved buyer questions to test.')

      const languages = Array.from(new Set(selected.map((prompt) => prompt.language)))
      const expectedPerSurface = selected.length * AUTOPILOT_REPETITIONS
      const surfacePreview = configuredSurfaces(project, '00000000-0000-0000-0000-000000000000', expectedPerSurface)

      if (!surfacePreview.length) {
        return await pause('no_observation_provider', 70, 'No observation provider API key is configured. Add at least one supported provider key before Autopilot can test the questions.')
      }

      const totalExpected = expectedPerSurface * surfacePreview.length
      if (totalExpected > 120) {
        return await pause('observation_budget_guardrail', 70, `Autopilot refused to create ${totalExpected} observation runs because the per-analysis safety cap is 120.`)
      }

      const { data: created, error: benchmarkError } = await ctx.supabase.from('benchmarks').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        created_by: userId,
        version: 1,
        benchmark_type: 'baseline',
        status: 'draft',
        collection_config: {
          panel_locked: true,
          prompt_count: selected.length,
          intent_count: approvedIntents.length,
          languages,
          repetitions_per_expression: AUTOPILOT_REPETITIONS,
          session_policy: 'fresh_session_each_run',
          geography: project.market,
          surface_policy: 'terminal_when_all_enabled_surfaces_are_complete_or_failed',
          analysis_mode: 'autopilot',
          max_observation_runs: 120,
        },
      }).select('id,status').single()

      if (benchmarkError || !created) return await pause('baseline_creation_failed', 70, benchmarkError?.message ?? 'Could not create autopilot baseline')

      const members = selected.map((prompt) => ({
        benchmark_id: created.id,
        workspace_id: project.workspace_id,
        project_id: project.id,
        buyer_intent_id: prompt.buyer_intent_id,
        prompt_expression_id: prompt.id,
      }))
      const memberInsert = await ctx.supabase.from('benchmark_prompts').insert(members)
      if (memberInsert.error) return await pause('baseline_membership_failed', 70, memberInsert.error.message)

      const surfaces = configuredSurfaces(project, created.id, expectedPerSurface)
      const surfaceInsert = await ctx.supabase.from('benchmark_surfaces').insert(surfaces)
      if (surfaceInsert.error) return await pause('surface_configuration_failed', 70, surfaceInsert.error.message)

      await ctx.supabase.from('prompt_expressions').update({ is_frozen: true }).in('id', selected.map((prompt) => prompt.id))
      baseline = created
      await updateRun({
        stage: 'baseline_ready',
        progress: 72,
        metadata: {
          ...record(run.metadata),
          benchmark_id: created.id,
          prompt_count: selected.length,
          provider_count: surfaces.length,
          expected_observations: totalExpected,
        },
      })
    }

    if (baseline.status !== 'complete' && baseline.status !== 'failed') {
      const activeTests = await stageJobs('observation_collection')
      const runningTest = activeTests.find((job) => job.status === 'running' || job.status === 'queued')
      if (runningTest) {
        const { data: surfaceState } = await ctx.supabase
          .from('benchmark_surfaces')
          .select('expected_runs,captured_runs,status,enabled')
          .eq('benchmark_id', baseline.id)
          .eq('enabled', true)

        const expected = (surfaceState ?? []).reduce((sum, item) => sum + Number(item.expected_runs || 0), 0)
        const captured = (surfaceState ?? []).reduce((sum, item) => sum + Number(item.captured_runs || 0), 0)
        const fractional = expected ? captured / expected : 0
        return await release('running_multi_model_tests', 74 + Math.round(fractional * 16), {
          benchmark_id: baseline.id,
          captured_observations: captured,
          expected_observations: expected,
        })
      }

      try {
        await updateRun({ stage: 'running_multi_model_tests', progress: 74 })
        await invoke('all-observation-runner', {
          project_id: project.id,
          benchmark_id: baseline.id,
        })
        return await release('running_multi_model_tests', 76, { benchmark_id: baseline.id })
      } catch (error) {
        return await pause('running_multi_model_tests_paused', 76, error instanceof Error ? error.message : 'Multi-model testing failed')
      }
    }

    if (baseline.status === 'failed') {
      const capturedCount = await ctx.supabase
        .from('observation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('benchmark_id', baseline.id)
        .eq('run_status', 'captured')

      if ((capturedCount.count ?? 0) === 0) {
        return await pause('multi_model_testing_failed', 88, 'All configured observation surfaces failed before a usable answer was captured. Autopilot stopped instead of retrying and spending more credits.')
      }
    }

    const [{ data: currentFindings }, { data: observedIntentRows }] = await Promise.all([
      ctx.supabase.from('findings').select('id,buyer_intent_id,review_status').eq('benchmark_id', baseline.id).eq('is_current', true),
      ctx.supabase.from('observation_runs').select('buyer_intent_id').eq('benchmark_id', baseline.id).eq('run_status', 'captured'),
    ])

    const observedIntentIds = new Set((observedIntentRows ?? []).map((row) => row.buyer_intent_id))
    const findingIntentIds = new Set((currentFindings ?? []).map((finding) => finding.buyer_intent_id).filter(Boolean))

    if (findingIntentIds.size < observedIntentIds.size) {
      const state = await shouldWaitOrPause('evaluation', undefined, 'generating_why_analysis', 92)
      if (state.response) return state.response

      try {
        await updateRun({ stage: 'generating_why_analysis', progress: 92 })
        await invoke('why-evaluator', {
          project_id: project.id,
          benchmark_id: baseline.id,
          max_intents: 4,
          regenerate: false,
        })
        return await release('generating_why_analysis', 96, { benchmark_id: baseline.id })
      } catch (error) {
        return await pause('generating_why_analysis_paused', 92, error instanceof Error ? error.message : 'WHY analysis failed')
      }
    }

    const unreviewed = (currentFindings ?? []).filter((finding) => finding.review_status !== 'approved')
    if (unreviewed.length) {
      await ctx.supabase.from('findings').update({
        review_status: 'approved',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      }).in('id', unreviewed.map((finding) => finding.id))

      await ctx.supabase.from('audit_events').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_user_id: userId,
        event_type: 'autopilot_findings_accepted',
        entity_type: 'benchmark',
        entity_id: baseline.id,
        payload: { count: unreviewed.length },
      })
    }

    await Promise.all([
      ctx.supabase.from('projects').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', project.id),
      updateRun({
        status: 'complete',
        stage: 'evaluation_complete',
        progress: 100,
        lease_until: null,
        completed_at: new Date().toISOString(),
        last_error: null,
      }),
    ])

    return json({
      complete: true,
      stage: 'evaluation_complete',
      progress: 100,
      benchmark_id: baseline.id,
      message: 'AI evaluation is complete. Company confirmation was the only required approval.',
    })
  }),
}

export default handler
