import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

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

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    const benchmarkId = body.benchmark_id?.trim()
    const maxIntents = Math.max(1, Math.min(Number(body.max_intents ?? 4), 8))
    if (!projectId || !benchmarkId) return json({ error: 'project_id and benchmark_id are required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'reasoning_provider_not_configured', message: 'OPENAI_API_KEY is not configured for WHY evaluation.' }, 503)

    const [{ data: project, error: projectError }, { data: benchmark, error: benchmarkError }, { data: profile, error: profileError }] = await Promise.all([
      ctx.supabase.from('projects').select('id,workspace_id,name,domain,market').eq('id', projectId).single(),
      ctx.supabase.from('benchmarks').select('id,status,benchmark_type,version,collection_config').eq('id', benchmarkId).eq('project_id', projectId).single(),
      ctx.supabase.from('company_profile_versions').select('id,company_name,summary,industry,business_model,products,services,audiences,geographies,claims,uncertainty').eq('project_id', projectId).eq('is_current', true).single(),
    ])

    if (projectError || benchmarkError || profileError || !project || !benchmark || !profile) return json({ error: 'Project, benchmark or Company Intelligence not found' }, 404)

    const { data: runs, error: runError } = await ctx.supabase
      .from('observation_runs')
      .select('id,buyer_intent_id,prompt_expression_id,provider,surface,model_label,repetition,language,run_status,retrieval_status,target_rank,raw_answer,extracted_brands,citations,metadata,captured_at,error_message')
      .eq('benchmark_id', benchmark.id)
    if (runError) return json({ error: runError.message }, 400)

    const capturedRuns = (runs ?? []).filter((run) => run.run_status === 'captured')
    if (!capturedRuns.length) return json({ error: 'captured_observations_required', message: 'WHY evaluation requires captured benchmark observations.' }, 409)

    const intentIds = Array.from(new Set(capturedRuns.map((run) => run.buyer_intent_id)))
    const { data: intents } = await ctx.supabase
      .from('buyer_intents')
      .select('id,intent_key,title,buyer,job_to_be_done,constraints,required_capabilities,geography,commercial_model,purchase_stage,priority')
      .in('id', intentIds)

    const { data: existingFindings } = await ctx.supabase
      .from('findings')
      .select('buyer_intent_id,is_current')
      .eq('benchmark_id', benchmark.id)
      .eq('is_current', true)

    const currentFindingIds = new Set((existingFindings ?? []).map((item) => item.buyer_intent_id).filter(Boolean))
    const eligibleIntents = (intents ?? []).filter((intent) => body.regenerate || !currentFindingIds.has(intent.id)).slice(0, maxIntents)

    if (!eligibleIntents.length) return json({ complete: true, generated: 0, message: 'All captured Buyer Intents already have current WHY findings.' })

    const [{ data: competitors }, { data: sources }] = await Promise.all([
      ctx.supabase.from('competitor_candidates').select('id,buyer_intent_id,company_name,domain,relationship,discovery_layer,matched_constraints,relaxed_constraints,evidence,evidence_strength,rationale,source_refs').eq('project_id', project.id).eq('is_current', true).eq('status', 'verified'),
      ctx.supabase.from('research_sources').select('id,url,title,source_type,metadata').eq('project_id', project.id).order('captured_at', { ascending: false }).limit(80),
    ])

    const sourceById = new Map((sources ?? []).map((source) => [source.id, source]))
    const model = Deno.env.get('RISEKLIX_WHY_MODEL') || 'gpt-5.6-sol'
    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      created_by: userId,
      job_type: 'why_evaluation',
      status: 'running',
      progress: 0,
      stage: 'preparing_why_evidence',
      idempotency_key: `why:${benchmark.id}:${model}:${crypto.randomUUID()}`,
      input: { benchmark_id: benchmark.id, model, intent_ids: eligibleIntents.map((intent) => intent.id) },
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start WHY evaluation' }, 400)

    const openai = new OpenAI({ apiKey })
    let generated = 0
    let skipped = 0

    for (let index = 0; index < eligibleIntents.length; index++) {
      const intent = eligibleIntents[index]
      const intentRuns = capturedRuns.filter((run) => run.buyer_intent_id === intent.id).map((run) => run as unknown as Record<string, unknown>)
      const summary = observationSummary(intentRuns, profile.company_name)
      if (!summary.unaided_captured) {
        skipped++
        continue
      }

      const intentCompetitors = (competitors ?? []).filter((candidate) => candidate.buyer_intent_id === intent.id)
      const referencedSourceIds = new Set<string>()
      for (const candidate of intentCompetitors) for (const ref of stringArray(candidate.source_refs)) referencedSourceIds.add(ref)

      const firstPartySources = (sources ?? []).filter((source) => source.source_type === 'first_party').slice(0, 12)
      for (const source of firstPartySources) referencedSourceIds.add(source.id)
      const evidenceSources = Array.from(referencedSourceIds).map((id) => sourceById.get(id)).filter(Boolean).map((source) => sourcePacket(source!))
      const validSourceIds = new Set(evidenceSources.map((source) => source.ref))

      const observationEvidence = intentRuns.map((run) => ({
        provider: run.provider,
        surface: run.surface,
        model_label: run.model_label,
        repetition: run.repetition,
        language: run.language,
        prompt_mode: record(run.metadata).prompt_mode ?? null,
        retrieval_status: run.retrieval_status,
        target_rank: run.target_rank,
        target_mentioned: record(run.metadata).target_mentioned ?? null,
        target_in_recommended_set: record(run.metadata).target_in_recommended_set ?? null,
        extracted_brands: run.extracted_brands,
        citations: run.citations,
        answer_excerpt: typeof run.raw_answer === 'string' ? run.raw_answer.slice(0, 5000) : null,
      }))

      try {
        const response = await openai.responses.create({
          model,
          reasoning: { effort: 'high' },
          instructions: `You are the WHY Evaluator for Riseklix Commercial Discovery.\n\nYou are interpreting captured observations and supplied evidence. You are NOT discovering new facts and you do not have permission to invent causes.\n\nThe fields OBSERVED and AIDED CONTROL have already been computed deterministically and are not yours to rewrite. Your job is to characterize competitor patterns, compare available evidence, identify counter-evidence, and decide whether action is justified.\n\nRules:\n1. explanation must always be framed as a possible explanation, never a proven cause. Use language such as “may”, “could”, “is consistent with”, or “one plausible explanation”.\n2. A retrieval miss does not prove a website/content deficiency. Models are stochastic; provider/surface coverage may be narrow.\n3. Distinguish entity understanding from selection. If aided controls recognize the company but unaided retrieval is weak, that is more consistent with selection/association/evidence issues than total entity absence.\n4. If aided controls also fail to recognize the target, entity/capability understanding may be a more plausible hypothesis, but still not proven.\n5. Compare the target only with the intent-specific competitor evidence supplied.\n6. Do not infer certifications, fleet, locations, rental, service coverage, SLAs or capabilities not present in the supplied evidence.\n7. Counter-evidence is mandatory. State what weakens the proposed explanation or what evidence points another way.\n8. “healthy”, “monitor”, “investigate”, “no_change”, and “uncertain” are valid outcomes. Do not manufacture work.\n9. evidence_strength reflects the support for the interpretation, not confidence in the model itself. Use strong only when multiple observation repetitions plus concrete evidence converge.\n10. source_refs may contain only supplied evidence-source refs.`,
          input: `Target company: ${profile.company_name}\nMarket: ${project.market}\n\nApproved Buyer Intent:\n${JSON.stringify(intent)}\n\nDeterministic observation summary:\n${JSON.stringify(summary)}\n\nCaptured observation evidence:\n${JSON.stringify(observationEvidence)}\n\nIntent-specific competitors:\n${JSON.stringify(intentCompetitors)}\n\nTarget + competitor evidence sources:\n${JSON.stringify(evidenceSources)}`,
          text: { format: { type: 'json_schema', name: 'riseklix_why_finding', strict: true, schema: WHY_SCHEMA } },
        })

        const raw = outputText(response)
        if (!raw) throw new Error('WHY model returned no structured output')
        const parsed = JSON.parse(raw) as WhyOutput
        const sourceRefs = parsed.source_refs.filter((ref) => validSourceIds.has(ref))

        if (body.regenerate) {
          await ctx.supabase.from('findings').update({ is_current: false }).eq('benchmark_id', benchmark.id).eq('buyer_intent_id', intent.id).eq('is_current', true)
        }

        const { data: finding, error: insertError } = await ctx.supabase.from('findings').insert({
          workspace_id: project.workspace_id,
          project_id: project.id,
          benchmark_id: benchmark.id,
          buyer_intent_id: intent.id,
          generation_job_id: job.id,
          is_current: true,
          source_refs: sourceRefs,
          finding_type: parsed.finding_type,
          severity: parsed.severity,
          decision: parsed.decision,
          observed: summary.observedText,
          aided_control: summary.aidedText,
          competitor_pattern: parsed.competitor_pattern,
          client_evidence: parsed.client_evidence,
          counter_evidence: parsed.counter_evidence,
          explanation: parsed.explanation,
          evidence_strength: parsed.evidence_strength,
          review_status: 'generated',
        }).select('id').single()

        if (insertError || !finding) throw insertError ?? new Error('Could not store WHY finding')

        const links = sourceRefs.map((sourceId) => ({
          workspace_id: project.workspace_id,
          project_id: project.id,
          source_id: sourceId,
          entity_type: 'finding',
          entity_id: finding.id,
          relation: 'context',
          claim_text: `Evidence context used in WHY evaluation for ${intent.intent_key}.`,
        }))
        if (links.length) await ctx.supabase.from('evidence_links').insert(links)

        generated++
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown WHY evaluation error'
        await ctx.supabase.from('review_queue_items').insert({
          workspace_id: project.workspace_id,
          project_id: project.id,
          research_job_id: job.id,
          entity_type: 'buyer_intent',
          entity_id: intent.id,
          priority: 'high',
          reason: `WHY evaluation failed for ${intent.intent_key}: ${message}`,
          status: 'open',
        })
      }

      await ctx.supabase.from('research_jobs').update({ progress: Math.round(((index + 1) / eligibleIntents.length) * 100), stage: `why_${index + 1}_of_${eligibleIntents.length}` }).eq('id', job.id)
    }

    const status = generated ? 'succeeded' : 'failed'
    await ctx.supabase.from('research_jobs').update({
      status,
      progress: 100,
      stage: generated ? 'why_findings_ready_for_review' : 'why_evaluation_failed',
      output: { benchmark_id: benchmark.id, model, generated, skipped, review_required: true },
      error: generated ? {} : { message: 'No WHY findings were generated in this batch.' },
      completed_at: new Date().toISOString(),
    }).eq('id', job.id)

    await ctx.supabase.from('audit_events').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      actor_user_id: userId,
      event_type: 'why_findings_generated',
      entity_type: 'benchmark',
      entity_id: benchmark.id,
      payload: { research_job_id: job.id, model, generated, skipped },
    })

    const currentCount = await ctx.supabase.from('findings').select('id', { count: 'exact', head: true }).eq('benchmark_id', benchmark.id).eq('is_current', true)
    const complete = (currentCount.count ?? 0) >= intentIds.length

    return json({ benchmark_id: benchmark.id, generated, skipped, current_findings: currentCount.count ?? 0, intents_with_captures: intentIds.length, complete })
  }),
}

export default handler
