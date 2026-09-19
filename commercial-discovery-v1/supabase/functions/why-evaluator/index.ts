import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'
import { openAIPromptCacheKey, recordOpenAIUsage } from '../_shared/openai-usage.ts'

type RequestBody = {
  project_id?: string
  benchmark_id?: string
  max_intents?: number
  regenerate?: boolean
}

type WhyOutput = {
  finding_type: 'retrieval_gap' | 'entity_gap' | 'capability_evidence_gap' | 'geography_gap' | 'commercial_association_gap' | 'problem_language_gap' | 'competitive_evidence_gap' | 'healthy' | 'uncertain'
  severity: 'urgent' | 'opportunity' | 'monitor' | 'healthy'
  decision: 'fix' | 'investigate' | 'monitor' | 'healthy' | 'no_change'
  competitor_pattern: string
  client_evidence: string
  counter_evidence: string
  explanation: string
  evidence_strength: 'weak' | 'moderate' | 'strong'
  source_refs: string[]
}

const WHY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['finding_type','severity','decision','competitor_pattern','client_evidence','counter_evidence','explanation','evidence_strength','source_refs'],
  properties: {
    finding_type: { type: 'string', enum: ['retrieval_gap','entity_gap','capability_evidence_gap','geography_gap','commercial_association_gap','problem_language_gap','competitive_evidence_gap','healthy','uncertain'] },
    severity: { type: 'string', enum: ['urgent','opportunity','monitor','healthy'] },
    decision: { type: 'string', enum: ['fix','investigate','monitor','healthy','no_change'] },
    competitor_pattern: { type: 'string' },
    client_evidence: { type: 'string' },
    counter_evidence: { type: 'string' },
    explanation: { type: 'string' },
    evidence_strength: { type: 'string', enum: ['weak','moderate','strong'] },
    source_refs: { type: 'array', items: { type: 'string' } },
  },
} as const

const BATCHED_WHY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['buyer_intent_id', ...WHY_SCHEMA.required],
        properties: {
          buyer_intent_id: { type: 'string' },
          ...WHY_SCHEMA.properties,
        },
      },
    },
  },
} as const

type BatchedWhyOutput = {
  findings: Array<WhyOutput & { buyer_intent_id: string }>
}

async function continueAutopilot(req: Request, projectId: string) {
  const authHeader = req.headers.get('Authorization')
  const apiKeyHeader = req.headers.get('apikey')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || (!authHeader && !apiKeyHeader)) return

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authHeader) headers.Authorization = authHeader
  if (apiKeyHeader) headers.apikey = apiKeyHeader
  else if (anonKey) headers.apikey = anonKey

  try {
    await fetch(supabaseUrl + '/functions/v1/auto-analysis-runner', {
      method: 'POST',
      headers,
      body: JSON.stringify({ project_id: projectId }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    // The current findings remain durable for a later retry.
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function outputText(response: unknown) {
  const value = record(response)
  if (typeof value.output_text === 'string') return value.output_text
  const output = Array.isArray(value.output) ? value.output : []
  for (const item of output) {
    const content = Array.isArray(record(item).content) ? record(item).content as unknown[] : []
    for (const part of content) {
      const block = record(part)
      if (typeof block.text === 'string') return block.text
    }
  }
  return ''
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function brandName(value: unknown) {
  const item = record(value)
  return typeof item.name === 'string' ? item.name : null
}

function sourcePacket(source: { id: string; url: string; title: string | null; source_type: string; metadata: unknown }) {
  const metadata = record(source.metadata)
  return {
    ref: source.id,
    url: source.url,
    title: source.title,
    source_type: source.source_type,
    source_role: typeof metadata.source_role === 'string' ? metadata.source_role : null,
    description: typeof metadata.description === 'string' ? metadata.description.slice(0, 700) : null,
    text_sample: typeof metadata.text_sample === 'string' ? metadata.text_sample.slice(0, 3500) : null,
    claim: typeof metadata.claim === 'string' ? metadata.claim.slice(0, 1000) : null,
  }
}

function observationSummary(runs: Array<Record<string, unknown>>, targetName: string) {
  const captured = runs.filter((run) => run.run_status === 'captured')
  const unaided = captured.filter((run) => record(run.metadata).prompt_mode === 'unaided')
  const aided = captured.filter((run) => record(run.metadata).prompt_mode === 'aided')
  const unaidedRetrieved = unaided.filter((run) => run.retrieval_status === 'retrieved')
  const aidedRecommended = aided.filter((run) => run.retrieval_status === 'retrieved')
  const aidedMentioned = aided.filter((run) => record(run.metadata).target_mentioned === true)
  const ranks = unaidedRetrieved.map((run) => Number(run.target_rank)).filter((rank) => Number.isFinite(rank) && rank > 0)

  const providerCounts = new Map<string, { captured: number; retrieved: number }>()
  for (const run of unaided) {
    const key = `${String(run.provider ?? 'unknown')} / ${String(run.surface ?? 'unknown')}`
    const current = providerCounts.get(key) ?? { captured: 0, retrieved: 0 }
    current.captured++
    if (run.retrieval_status === 'retrieved') current.retrieved++
    providerCounts.set(key, current)
  }

  const brands = new Map<string, number>()
  for (const run of unaided) {
    const extracted = Array.isArray(run.extracted_brands) ? run.extracted_brands : []
    for (const value of extracted) {
      const item = record(value)
      if (item.in_recommended_set !== true) continue
      const name = brandName(value)
      if (!name || name.toLowerCase() === targetName.toLowerCase()) continue
      brands.set(name, (brands.get(name) ?? 0) + 1)
    }
  }

  const providerText = Array.from(providerCounts.entries()).map(([surface, counts]) => `${surface}: ${counts.retrieved}/${counts.captured} retrieved`).join('; ')
  const topBrands = Array.from(brands.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} (${count}/${unaided.length || 0})`)

  return {
    captured_total: captured.length,
    unaided_captured: unaided.length,
    unaided_retrieved: unaidedRetrieved.length,
    aided_captured: aided.length,
    aided_target_mentioned: aidedMentioned.length,
    aided_target_recommended: aidedRecommended.length,
    unaided_ranks: ranks,
    providers: providerText,
    top_recommended_brands: topBrands,
    observedText: unaided.length
      ? `Across ${unaided.length} captured unaided observation${unaided.length === 1 ? '' : 's'}, ${targetName} appeared in the recommended or shortlisted provider set ${unaidedRetrieved.length} time${unaidedRetrieved.length === 1 ? '' : 's'}${ranks.length ? `; observed target ranks were ${ranks.join(', ')}` : ''}. ${providerText || 'No provider split available.'}`
      : `No captured unaided observations are available for ${targetName} in this Buyer Intent.`,
    aidedText: aided.length
      ? `Across ${aided.length} captured aided control${aided.length === 1 ? '' : 's'}, the target was explicitly mentioned ${aidedMentioned.length} time${aidedMentioned.length === 1 ? '' : 's'} and placed in the recommended set ${aidedRecommended.length} time${aidedRecommended.length === 1 ? '' : 's'}.`
      : 'No captured aided control is available for this Buyer Intent.',
  }
}

function compactObservationEvidence(runs: Array<Record<string, unknown>>) {
  const captured = runs.filter((run) => run.run_status === 'captured')
  const selected: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  const take = (predicate: (run: Record<string, unknown>) => boolean, limit: number) => {
    for (const run of captured) {
      if (selected.length >= 5 || limit <= 0) break
      if (!predicate(run)) continue
      const key = `${String(run.provider)}:${String(run.prompt_expression_id)}:${String(run.repetition)}`
      if (seen.has(key)) continue
      seen.add(key)
      selected.push(run)
      limit--
    }
  }

  take((run) => record(run.metadata).prompt_mode === 'unaided' && run.retrieval_status === 'retrieved', 2)
  take((run) => record(run.metadata).prompt_mode === 'unaided' && run.retrieval_status !== 'retrieved', 2)
  take((run) => record(run.metadata).prompt_mode === 'aided', 1)

  return selected.map((run) => ({
    provider: run.provider,
    surface: run.surface,
    prompt_mode: record(run.metadata).prompt_mode ?? null,
    retrieval_status: run.retrieval_status,
    target_rank: run.target_rank,
    target_mentioned: record(run.metadata).target_mentioned ?? null,
    target_in_recommended_set: record(run.metadata).target_in_recommended_set ?? null,
    recommended_brands: (Array.isArray(run.extracted_brands) ? run.extracted_brands : [])
      .filter((value) => record(value).in_recommended_set === true)
      .map((value) => brandName(value))
      .filter(Boolean)
      .slice(0, 8),
    citation_urls: (Array.isArray(run.citations) ? run.citations : [])
      .map((value) => record(value).url)
      .filter((value): value is string => typeof value === 'string')
      .slice(0, 6),
    answer_excerpt: typeof run.raw_answer === 'string'
      ? run.raw_answer.replace(/\s+/g, ' ').trim().slice(0, 900)
      : null,
  }))
}

const handler = {
  fetch: withSupabase({ auth: ['user','secret'] }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const db = ctx.authMode === 'user' ? ctx.supabase : ctx.supabaseAdmin

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    const benchmarkId = body.benchmark_id?.trim()
    const maxIntents = Math.max(1, Math.min(Number(body.max_intents ?? 4), 8))
    if (!projectId || !benchmarkId) return json({ error: 'project_id and benchmark_id are required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'reasoning_provider_not_configured', message: 'OPENAI_API_KEY is not configured for WHY evaluation.' }, 503)

    const [{ data: project, error: projectError }, { data: benchmark, error: benchmarkError }, { data: profile, error: profileError }] = await Promise.all([
      db.from('projects').select('id,workspace_id,name,domain,market').eq('id', projectId).single(),
      db.from('benchmarks').select('id,status,benchmark_type,version,collection_config').eq('id', benchmarkId).eq('project_id', projectId).single(),
      db.from('company_profile_versions').select('id,company_name,summary,industry,business_model,products,services,audiences,geographies,claims,uncertainty').eq('project_id', projectId).eq('is_current', true).single(),
    ])

    if (projectError || benchmarkError || profileError || !project || !benchmark || !profile) return json({ error: 'Project, benchmark or Company Intelligence not found' }, 404)

    const [{ data: runs, error: runError }, { data: surfaceRows, error: surfaceError }] = await Promise.all([
      db
        .from('observation_runs')
        .select('id,buyer_intent_id,prompt_expression_id,provider,surface,model_label,repetition,language,run_status,retrieval_status,target_rank,raw_answer,extracted_brands,citations,metadata,captured_at,error_message')
        .eq('benchmark_id', benchmark.id),
      db
        .from('benchmark_surfaces')
        .select('provider,expected_runs,captured_runs,status,enabled')
        .eq('benchmark_id', benchmark.id)
        .eq('enabled', true),
    ])
    if (runError) return json({ error: runError.message }, 400)
    if (surfaceError) return json({ error: surfaceError.message }, 400)

    const benchmarkConfig = record(benchmark.collection_config)
    const frozenUsableProviders = stringArray(benchmarkConfig.usable_providers)
    const rawCapturedRuns = (runs ?? []).filter((run) => run.run_status === 'captured')
    const usableProviderSet = frozenUsableProviders.length
      ? new Set(frozenUsableProviders)
      : new Set(
          benchmark.status === 'complete' || benchmark.status === 'failed'
            ? (surfaceRows ?? [])
                .filter((surface) => {
                  const expectedRuns = Number(surface.expected_runs || 0)
                  const capturedRuns = Number(surface.captured_runs || 0)
                  return capturedRuns >= Math.max(1, Math.ceil(expectedRuns * 0.5))
                })
                .map((surface) => surface.provider)
            : rawCapturedRuns.map((run) => run.provider),
        )
    const excludedProviders = Array.from(new Set((surfaceRows ?? []).map((surface) => surface.provider)))
      .filter((provider) => !usableProviderSet.has(provider))
    const capturedRuns = rawCapturedRuns.filter((run) => usableProviderSet.has(run.provider))

    if (!capturedRuns.length) {
      return json({
        error: 'usable_captured_observations_required',
        message: 'WHY evaluation requires captured observations from providers admitted by the benchmark coverage policy.',
        excluded_providers: excludedProviders,
      }, 409)
    }

    const intentIds = Array.from(new Set(capturedRuns.map((run) => run.buyer_intent_id)))
    const { data: intents } = await db
      .from('buyer_intents')
      .select('id,intent_key,title,buyer,job_to_be_done,constraints,required_capabilities,geography,commercial_model,purchase_stage,priority')
      .in('id', intentIds)

    const { data: existingFindings } = await db
      .from('findings')
      .select('buyer_intent_id,is_current')
      .eq('benchmark_id', benchmark.id)
      .eq('is_current', true)

    const currentFindingIds = new Set((existingFindings ?? []).map((item) => item.buyer_intent_id).filter(Boolean))
    const eligibleIntents = (intents ?? []).filter((intent) => body.regenerate || !currentFindingIds.has(intent.id)).slice(0, maxIntents)

    if (!eligibleIntents.length) return json({ complete: true, generated: 0, message: 'All captured Buyer Intents already have current WHY findings.' })

    const [{ data: competitors }, { data: sources }] = await Promise.all([
      db.from('competitor_candidates').select('id,buyer_intent_id,company_name,domain,relationship,discovery_layer,matched_constraints,relaxed_constraints,evidence,evidence_strength,rationale,source_refs').eq('project_id', project.id).eq('is_current', true).eq('status', 'verified'),
      db.from('research_sources').select('id,url,title,source_type,metadata').eq('project_id', project.id).order('captured_at', { ascending: false }).limit(80),
    ])

    const sourceById = new Map((sources ?? []).map((source) => [source.id, source]))
    const model = Deno.env.get('RISEKLIX_WHY_MODEL') || 'gpt-5.6-sol'
    const budgetRpc = ctx.authMode === 'user' ? 'consume_ai_budget' : 'consume_ai_budget_internal'
    const budget = await db.rpc(budgetRpc, {
      p_project_id: project.id,
      p_kind: 'reasoning',
      p_units: 1,
    })
    if (budget.error) return json({ error: 'ai_budget_check_failed', message: budget.error.message }, 500)
    const budgetState = record(budget.data)
    if (budgetState.allowed !== true) {
      return json({
        error: 'ai_budget_exceeded',
        message: budgetState.blocked_scope === 'minute' ? 'Riseklix hit the workspace per-minute AI safety limit. The request was stopped before another paid model call.' : 'Riseklix hit the workspace daily AI safety limit. The request was stopped before another paid model call.',
        usage: budgetState,
      }, 429)
    }

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await db.from('research_jobs').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      created_by: userId,
      job_type: 'why_evaluation',
      status: 'running',
      progress: 0,
      stage: 'preparing_why_evidence',
      idempotency_key: `why:${benchmark.id}:${model}:${crypto.randomUUID()}`,
      input: {
        benchmark_id: benchmark.id,
        model,
        intent_ids: eligibleIntents.map((intent) => intent.id),
        usable_providers: Array.from(usableProviderSet),
        excluded_providers: excludedProviders,
      },
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start WHY evaluation' }, 400)

    const openai = new OpenAI({ apiKey })
    let generated = 0
    let skipped = 0

    const packets = eligibleIntents.map((intent) => {
      const intentRuns = capturedRuns
        .filter((run) => run.buyer_intent_id === intent.id)
        .map((run) => run as unknown as Record<string, unknown>)
      const summary = observationSummary(intentRuns, profile.company_name)

      if (!summary.unaided_captured) {
        skipped++
        return null
      }

      const intentCompetitors = (competitors ?? []).filter((candidate) => candidate.buyer_intent_id === intent.id)
      const referencedSourceIds = new Set<string>()
      for (const candidate of intentCompetitors) {
        for (const ref of stringArray(candidate.source_refs)) referencedSourceIds.add(ref)
      }

      const firstPartySources = (sources ?? [])
        .filter((source) => source.source_type === 'first_party')
        .slice(0, 8)
      for (const source of firstPartySources) referencedSourceIds.add(source.id)

      const evidenceSources = Array.from(referencedSourceIds)
        .map((id) => sourceById.get(id))
        .filter(Boolean)
        .map((source) => sourcePacket(source!))

      return {
        intent,
        summary,
        compact_observations: compactObservationEvidence(intentRuns),
        competitors: intentCompetitors.map((candidate) => ({
          company_name: candidate.company_name,
          domain: candidate.domain,
          relationship: candidate.relationship,
          discovery_layer: candidate.discovery_layer,
          matched_constraints: candidate.matched_constraints,
          relaxed_constraints: candidate.relaxed_constraints,
          evidence_strength: candidate.evidence_strength,
          rationale: candidate.rationale,
          source_refs: candidate.source_refs,
        })),
        evidence_sources: evidenceSources,
        valid_source_ids: evidenceSources.map((source) => source.ref),
      }
    }).filter(Boolean) as Array<{
      intent: NonNullable<typeof eligibleIntents>[number]
      summary: ReturnType<typeof observationSummary>
      compact_observations: ReturnType<typeof compactObservationEvidence>
      competitors: Array<Record<string, unknown>>
      evidence_sources: ReturnType<typeof sourcePacket>[]
      valid_source_ids: string[]
    }>

    if (packets.length) {
      try {
        const response = await openai.responses.create({
          model,
          reasoning: { effort: 'high' },
          prompt_cache_key: openAIPromptCacheKey(project.id, 'why'),
          prompt_cache_options: { mode: 'implicit', ttl: '30m' },
          instructions: `You are the WHY Evaluator for Riseklix Commercial Discovery.

You are interpreting captured observations and supplied evidence. You are NOT discovering new facts and you do not have permission to invent causes.

You will receive several Buyer Intents together. Return exactly one finding for every supplied buyer_intent_id. Looking across intents for repeated patterns is allowed, but each finding must remain specific to its own commercial buying situation.

The OBSERVED and AIDED CONTROL summaries are deterministic and are not yours to rewrite. Your job is to characterize competitor patterns, compare available evidence, identify counter-evidence, and decide whether action is justified.

Rules:
1. explanation must always be framed as a possible explanation, never a proven cause. Use language such as “may”, “could”, “is consistent with”, or “one plausible explanation”.
2. A retrieval miss does not prove a website/content deficiency. Models are stochastic; provider/surface coverage may be narrow.
3. Distinguish entity understanding from selection. If aided controls recognize the company but unaided retrieval is weak, that is more consistent with selection/association/evidence issues than total entity absence.
4. If aided controls also fail to recognize the target, entity/capability understanding may be a more plausible hypothesis, but still not proven.
5. Compare the target only with the intent-specific competitor evidence supplied for that buyer_intent_id.
6. Do not infer certifications, locations, service coverage, SLAs or capabilities not present in the supplied evidence.
7. Counter-evidence is mandatory.
8. healthy, monitor, investigate, no_change, and uncertain are valid outcomes. Do not manufacture work.
9. evidence_strength reflects support for the interpretation, not confidence in the model itself.
10. source_refs may contain only refs supplied inside that intent packet.
11. The compact observation excerpts are representative context only. The deterministic summary is authoritative for counts, ranks and aided/unaided rates.`,
          input: `Target company: ${profile.company_name}
Market: ${project.market}

Approved Company Intelligence summary:
${JSON.stringify({
  summary: profile.summary,
  industry: profile.industry,
  business_model: profile.business_model,
  products: profile.products,
  services: profile.services,
  audiences: profile.audiences,
  geographies: profile.geographies,
  uncertainty: profile.uncertainty,
})}

Buyer Intent evidence packets:
${JSON.stringify(packets)}`,
          text: {
            format: {
              type: 'json_schema',
              name: 'riseklix_batched_why_findings',
              strict: true,
              schema: BATCHED_WHY_SCHEMA,
            },
          },
        })

        await recordOpenAIUsage(db, response, {
          workspaceId: project.workspace_id,
          projectId: project.id,
          researchJobId: job.id,
          stage: 'why_evaluation',
          model,
          metadata: {
            benchmark_id: benchmark.id,
            buyer_intent_ids: packets.map((packet) => packet.intent.id),
            batched_intent_count: packets.length,
            evidence_mode: 'deterministic_summary_plus_representative_excerpts',
            usable_providers: Array.from(usableProviderSet),
            excluded_providers: excludedProviders,
          },
        })

        const raw = outputText(response)
        if (!raw) throw new Error('WHY model returned no structured output')
        const parsed = JSON.parse(raw) as BatchedWhyOutput
        const resultByIntent = new Map(parsed.findings.map((finding) => [finding.buyer_intent_id, finding]))

        for (let index = 0; index < packets.length; index++) {
          const packet = packets[index]
          const intent = packet.intent
          const findingOutput = resultByIntent.get(intent.id)

          if (!findingOutput) {
            await db.from('review_queue_items').insert({
              workspace_id: project.workspace_id,
              project_id: project.id,
              research_job_id: job.id,
              entity_type: 'buyer_intent',
              entity_id: intent.id,
              priority: 'high',
              reason: `WHY batch omitted ${intent.intent_key}; manual review is required.`,
              status: 'open',
            })
            continue
          }

          const validSourceIds = new Set(packet.valid_source_ids)
          const sourceRefs = findingOutput.source_refs.filter((ref) => validSourceIds.has(ref))

          if (body.regenerate) {
            await db
              .from('findings')
              .update({ is_current: false })
              .eq('benchmark_id', benchmark.id)
              .eq('buyer_intent_id', intent.id)
              .eq('is_current', true)
          }

          const { data: finding, error: insertError } = await db.from('findings').insert({
            workspace_id: project.workspace_id,
            project_id: project.id,
            benchmark_id: benchmark.id,
            buyer_intent_id: intent.id,
            generation_job_id: job.id,
            is_current: true,
            source_refs: sourceRefs,
            finding_type: findingOutput.finding_type,
            severity: findingOutput.severity,
            decision: findingOutput.decision,
            observed: packet.summary.observedText,
            aided_control: packet.summary.aidedText,
            competitor_pattern: findingOutput.competitor_pattern,
            client_evidence: findingOutput.client_evidence,
            counter_evidence: findingOutput.counter_evidence,
            explanation: findingOutput.explanation,
            evidence_strength: findingOutput.evidence_strength,
            review_status: 'generated',
          }).select('id').single()

          if (insertError || !finding) throw insertError ?? new Error(`Could not store WHY finding for ${intent.intent_key}`)

          const links = sourceRefs.map((sourceId) => ({
            workspace_id: project.workspace_id,
            project_id: project.id,
            source_id: sourceId,
            entity_type: 'finding',
            entity_id: finding.id,
            relation: 'context',
            claim_text: `Evidence context used in WHY evaluation for ${intent.intent_key}.`,
          }))
          if (links.length) await db.from('evidence_links').insert(links)

          generated++
          await db.from('research_jobs').update({
            progress: Math.round(((index + 1) / packets.length) * 100),
            stage: `why_storing_${index + 1}_of_${packets.length}`,
          }).eq('id', job.id)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown WHY evaluation error'
        for (const packet of packets) {
          await db.from('review_queue_items').insert({
            workspace_id: project.workspace_id,
            project_id: project.id,
            research_job_id: job.id,
            entity_type: 'buyer_intent',
            entity_id: packet.intent.id,
            priority: 'high',
            reason: `WHY evaluation failed for ${packet.intent.intent_key}: ${message}`,
            status: 'open',
          })
        }
      }
    }

    const status = generated ? 'succeeded' : 'failed'
    await db.from('research_jobs').update({
      status,
      progress: 100,
      stage: generated ? 'why_findings_ready_for_review' : 'why_evaluation_failed',
      output: { benchmark_id: benchmark.id, model, generated, skipped, review_required: true },
      error: generated ? {} : { message: 'No WHY findings were generated in this batch.' },
      completed_at: new Date().toISOString(),
    }).eq('id', job.id)

    await db.from('audit_events').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      actor_user_id: userId,
      event_type: 'why_findings_generated',
      entity_type: 'benchmark',
      entity_id: benchmark.id,
      payload: { research_job_id: job.id, model, generated, skipped },
    })

    const currentCount = await db.from('findings').select('id', { count: 'exact', head: true }).eq('benchmark_id', benchmark.id).eq('is_current', true)
    const complete = (currentCount.count ?? 0) >= intentIds.length

    await continueAutopilot(req, project.id)

    return json({ benchmark_id: benchmark.id, generated, skipped, current_findings: currentCount.count ?? 0, intents_with_captures: intentIds.length, complete })
  }),
}

export default handler
