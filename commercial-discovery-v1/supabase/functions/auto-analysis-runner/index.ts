import { withSupabase } from 'npm:@supabase/server'

type RequestBody = { project_id?: string }

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function configuredSurfaces(project: { id: string; workspace_id: string }, benchmarkId: string, expectedRuns: number) {
  const surfaces: Array<Record<string, unknown>> = [
    {
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
    },
  ]

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

    const invoke = async (name: string, payload: Record<string, unknown>) => {
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

    const { data: project, error: projectError } = await ctx.supabase
      .from('projects')
      .select('id,workspace_id,name,market,analysis_mode')
      .eq('id', projectId)
      .single()

    if (projectError || !project) return json({ error: 'Project not found' }, 404)
    if (project.analysis_mode !== 'autopilot') return json({ skipped: true, stage: 'manual_mode' })

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: profile } = await ctx.supabase
      .from('company_profile_versions')
      .select('id,status')
      .eq('project_id', project.id)
      .eq('is_current', true)
      .maybeSingle()

    if (!profile || profile.status !== 'approved') {
      return json({ pending: true, stage: 'waiting_for_company_confirmation', message: 'Company Intelligence still needs the one required confirmation.' })
    }

    const { data: intents } = await ctx.supabase
      .from('buyer_intents')
      .select('id,status,intent_key')
      .eq('project_id', project.id)
      .order('created_at')

    if (!intents?.length) {
      await invoke('intent-suggestor', { project_id: project.id })
      return json({ pending: true, stage: 'generating_buyer_situations' })
    }

    const candidates = intents.filter((intent) => intent.status === 'candidate')
    if (candidates.length) {
      const now = new Date().toISOString()
      await ctx.supabase.from('buyer_intents').update({
        status: 'approved',
        approved_by: userId,
        approved_at: now,
      }).in('id', candidates.map((intent) => intent.id))

      await ctx.supabase.from('audit_events').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_user_id: userId,
        event_type: 'autopilot_buyer_intents_approved',
        entity_type: 'project',
        entity_id: project.id,
        payload: { count: candidates.length },
      })
    }

    const { data: approvedIntents } = await ctx.supabase
      .from('buyer_intents')
      .select('id,intent_key')
      .eq('project_id', project.id)
      .eq('status', 'approved')
      .order('created_at')

    if (!approvedIntents?.length) return json({ error: 'Autopilot has no approved Buyer Situations to continue with.' }, 409)

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
      await invoke('competitor-discovery', {
        project_id: project.id,
        intent_id: nextCompetitorIntent.id,
        regenerate: false,
      })
      return json({ pending: true, stage: 'researching_competitors', intent_id: nextCompetitorIntent.id })
    }

    const { data: promptRows } = await ctx.supabase
      .from('prompt_expressions')
      .select('id,buyer_intent_id,mode,status,is_frozen')
      .in('buyer_intent_id', intentIds)

    const candidatePrompts = (promptRows ?? []).filter((prompt) => prompt.status === 'candidate' && !prompt.is_frozen)
    if (candidatePrompts.length) {
      await ctx.supabase.from('prompt_expressions').update({ status: 'approved' }).in('id', candidatePrompts.map((prompt) => prompt.id))
      await ctx.supabase.from('audit_events').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_user_id: userId,
        event_type: 'autopilot_questions_approved',
        entity_type: 'project',
        entity_id: project.id,
        payload: { count: candidatePrompts.length },
      })
    }

    const { data: approvedPrompts } = await ctx.supabase
      .from('prompt_expressions')
      .select('id,buyer_intent_id,language,mode,status,is_frozen')
      .in('buyer_intent_id', intentIds)
      .eq('status', 'approved')

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
      await invoke('prompt-expression-generator', {
        project_id: project.id,
        intent_id: nextPromptIntent.id,
        regenerate: false,
      })
      return json({ pending: true, stage: 'generating_buyer_questions', intent_id: nextPromptIntent.id })
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
      const selected = approvedPrompts ?? []
      const repetitions = 3
      const languages = Array.from(new Set(selected.map((prompt) => prompt.language)))

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
          repetitions_per_expression: repetitions,
          session_policy: 'fresh_session_each_run',
          geography: project.market,
          surface_policy: 'benchmark_complete_only_when_all_enabled_surfaces_complete',
          analysis_mode: 'autopilot',
        },
      }).select('id,status').single()

      if (benchmarkError || !created) return json({ error: benchmarkError?.message ?? 'Could not create autopilot baseline' }, 400)

      const members = selected.map((prompt) => ({
        benchmark_id: created.id,
        workspace_id: project.workspace_id,
        project_id: project.id,
        buyer_intent_id: prompt.buyer_intent_id,
        prompt_expression_id: prompt.id,
      }))
      const memberInsert = await ctx.supabase.from('benchmark_prompts').insert(members)
      if (memberInsert.error) return json({ error: memberInsert.error.message }, 400)

      const surfaces = configuredSurfaces(project, created.id, selected.length * repetitions)
      const surfaceInsert = await ctx.supabase.from('benchmark_surfaces').insert(surfaces)
      if (surfaceInsert.error) return json({ error: surfaceInsert.error.message }, 400)

      await ctx.supabase.from('prompt_expressions').update({ is_frozen: true }).in('id', selected.map((prompt) => prompt.id))
      baseline = created
    }

    if (baseline.status !== 'complete') {
      await invoke('all-observation-runner', {
        project_id: project.id,
        benchmark_id: baseline.id,
      })
      return json({ pending: true, stage: 'running_multi_model_tests', benchmark_id: baseline.id })
    }

    const [{ data: currentFindings }, { data: observedIntentRows }] = await Promise.all([
      ctx.supabase.from('findings').select('id,buyer_intent_id,review_status').eq('benchmark_id', baseline.id).eq('is_current', true),
      ctx.supabase.from('observation_runs').select('buyer_intent_id').eq('benchmark_id', baseline.id).eq('run_status', 'captured'),
    ])

    const observedIntentIds = new Set((observedIntentRows ?? []).map((row) => row.buyer_intent_id))
    const findingIntentIds = new Set((currentFindings ?? []).map((finding) => finding.buyer_intent_id).filter(Boolean))

    if (findingIntentIds.size < observedIntentIds.size) {
      await invoke('why-evaluator', {
        project_id: project.id,
        benchmark_id: baseline.id,
        max_intents: 4,
        regenerate: false,
      })
      return json({ pending: true, stage: 'generating_why_analysis', benchmark_id: baseline.id })
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

    await ctx.supabase.from('projects').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', project.id)

    return json({
      complete: true,
      stage: 'evaluation_complete',
      benchmark_id: baseline.id,
      message: 'AI evaluation is complete. Company confirmation was the only required approval.',
    })
  }),
}

export default handler
