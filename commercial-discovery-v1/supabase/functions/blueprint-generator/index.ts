import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

type RequestBody = {
  project_id?: string
  finding_id?: string
  regenerate?: boolean
}

type BlueprintOutput = {
  title: string
  objective: string
  target_mode: 'existing_page' | 'new_page' | 'sitewide' | 'evidence_asset'
  target_url: string
  suggested_h1: string
  required_sections: Array<{
    heading: string
    purpose: string
    requirements: string[]
    source_refs: string[]
  }>
  evidence_required: Array<{
    item: string
    why: string
    source_refs: string[]
  }>
  claims_to_verify: string[]
  internal_links: Array<{
    from_url: string
    to_url: string
    anchor_intent: string
  }>
  structured_data: {
    recommended_types: string[]
    reason: string
    prerequisites: string[]
  }
  acceptance_criteria: string[]
  implementation_brief: string
  opening_answer: string
  content_notes: string[]
  technical_notes: string[]
  measurement_plan: string[]
  source_refs: string[]
}

const BLUEPRINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title','objective','target_mode','target_url','suggested_h1','required_sections','evidence_required','claims_to_verify','internal_links','structured_data','acceptance_criteria','implementation_brief','opening_answer','content_notes','technical_notes','measurement_plan','source_refs'],
  properties: {
    title: { type: 'string' },
    objective: { type: 'string' },
    target_mode: { type: 'string', enum: ['existing_page','new_page','sitewide','evidence_asset'] },
    target_url: { type: 'string' },
    suggested_h1: { type: 'string' },
    required_sections: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['heading','purpose','requirements','source_refs'],
        properties: {
          heading: { type: 'string' },
          purpose: { type: 'string' },
          requirements: { type: 'array', items: { type: 'string' } },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    evidence_required: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['item','why','source_refs'],
        properties: {
          item: { type: 'string' },
          why: { type: 'string' },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    claims_to_verify: { type: 'array', items: { type: 'string' } },
    internal_links: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['from_url','to_url','anchor_intent'],
        properties: {
          from_url: { type: 'string' },
          to_url: { type: 'string' },
          anchor_intent: { type: 'string' },
        },
      },
    },
    structured_data: {
      type: 'object', additionalProperties: false,
      required: ['recommended_types','reason','prerequisites'],
      properties: {
        recommended_types: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
        prerequisites: { type: 'array', items: { type: 'string' } },
      },
    },
    acceptance_criteria: { type: 'array', items: { type: 'string' } },
    implementation_brief: { type: 'string' },
    opening_answer: { type: 'string' },
    content_notes: { type: 'array', items: { type: 'string' } },
    technical_notes: { type: 'array', items: { type: 'string' } },
    measurement_plan: { type: 'array', items: { type: 'string' } },
    source_refs: { type: 'array', items: { type: 'string' } },
  },
} as const

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
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

function sourcePacket(source: { id: string; url: string; title: string | null; source_type: string; metadata: unknown }) {
  const metadata = record(source.metadata)
  return {
    ref: source.id,
    url: source.url,
    title: source.title,
    source_type: source.source_type,
    source_role: typeof metadata.source_role === 'string' ? metadata.source_role : null,
    description: typeof metadata.description === 'string' ? metadata.description.slice(0, 800) : null,
    text_sample: typeof metadata.text_sample === 'string' ? metadata.text_sample.slice(0, 4500) : null,
    claim: typeof metadata.claim === 'string' ? metadata.claim.slice(0, 1200) : null,
  }
}

function targetAllowed(targetMode: BlueprintOutput['target_mode'], targetUrl: string, domain: string, firstPartyUrls: Set<string>) {
  if (targetMode === 'sitewide' || targetMode === 'evidence_asset') return true
  try {
    const raw = targetUrl.startsWith('/') ? `https://${domain}${targetUrl}` : targetUrl
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const targetHost = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    if (host !== targetHost) return false
    if (targetMode === 'existing_page') return firstPartyUrls.has(url.toString()) || firstPartyUrls.has(url.toString().replace(/\/$/, ''))
    return true
  } catch {
    return false
  }
}

function filterRefs(refs: string[], valid: Set<string>) {
  return refs.filter((ref) => valid.has(ref))
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: RequestBody
    try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

    const projectId = body.project_id?.trim()
    const findingId = body.finding_id?.trim()
    if (!projectId || !findingId) return json({ error: 'project_id and finding_id are required' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'reasoning_provider_not_configured', message: 'OPENAI_API_KEY is not configured for Blueprint generation.' }, 503)

    const [{ data: project, error: projectError }, { data: finding, error: findingError }, { data: profile, error: profileError }] = await Promise.all([
      ctx.supabase.from('projects').select('id,workspace_id,name,domain,market').eq('id', projectId).single(),
      ctx.supabase.from('findings').select('id,benchmark_id,buyer_intent_id,finding_type,severity,decision,observed,aided_control,competitor_pattern,client_evidence,counter_evidence,explanation,evidence_strength,review_status,source_refs,is_current').eq('id', findingId).eq('project_id', projectId).single(),
      ctx.supabase.from('company_profile_versions').select('id,company_name,summary,industry,business_model,products,services,audiences,geographies,claims,uncertainty').eq('project_id', projectId).eq('is_current', true).single(),
    ])

    if (projectError || findingError || profileError || !project || !finding || !profile) return json({ error: 'Project, finding or Company Intelligence not found' }, 404)
    if (!finding.is_current || finding.review_status !== 'approved') return json({ error: 'approved_finding_required', message: 'Approve the current WHY finding before generating a Blueprint.' }, 409)
    if (finding.decision !== 'fix') return json({ error: 'fix_not_justified', message: `This finding is ${finding.decision}; Riseklix will not manufacture an implementation Blueprint.` }, 409)
    if (!finding.buyer_intent_id) return json({ error: 'buyer_intent_required' }, 409)

    const { data: existingBlueprints } = await ctx.supabase.from('blueprints').select('id,version,status').eq('finding_id', finding.id).order('version', { ascending: false })
    if (!body.regenerate && existingBlueprints?.length) return json({ reused: true, blueprint: existingBlueprints[0] })
    const nextVersion = (existingBlueprints?.[0]?.version ?? 0) + 1

    const [{ data: intent }, { data: competitors }, { data: sources }] = await Promise.all([
      ctx.supabase.from('buyer_intents').select('id,intent_key,title,buyer,job_to_be_done,constraints,required_capabilities,geography,commercial_model,purchase_stage,priority').eq('id', finding.buyer_intent_id).single(),
      ctx.supabase.from('competitor_candidates').select('company_name,domain,relationship,discovery_layer,evidence_strength,rationale,matched_constraints,relaxed_constraints,source_refs').eq('buyer_intent_id', finding.buyer_intent_id).eq('is_current', true).eq('status', 'verified'),
      ctx.supabase.from('research_sources').select('id,url,title,source_type,metadata').eq('project_id', project.id).order('captured_at', { ascending: false }).limit(100),
    ])

    if (!intent) return json({ error: 'Buyer Intent could not be loaded' }, 404)

    const findingRefs = new Set(stringArray(finding.source_refs))
    const firstPartySources = (sources ?? []).filter((source) => source.source_type === 'first_party').slice(0, 24)
    for (const source of firstPartySources) findingRefs.add(source.id)
    for (const candidate of competitors ?? []) for (const ref of stringArray(candidate.source_refs)) findingRefs.add(ref)

    const sourceById = new Map((sources ?? []).map((source) => [source.id, source]))
    const evidenceSources = Array.from(findingRefs).map((id) => sourceById.get(id)).filter(Boolean).map((source) => sourcePacket(source!))
    const validSourceIds = new Set(evidenceSources.map((source) => source.ref))
    const firstPartyUrls = new Set(firstPartySources.flatMap((source) => [source.url, source.url.replace(/\/$/, '')]))

    const model = Deno.env.get('RISEKLIX_BLUEPRINT_MODEL') || 'gpt-5.6-terra'
    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const { data: job, error: jobError } = await ctx.supabase.from('research_jobs').insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      created_by: userId,
      job_type: 'blueprint_generation',
      status: 'running',
      progress: 15,
      stage: 'preparing_blueprint_evidence',
      idempotency_key: `blueprint:${finding.id}:v${nextVersion}:${model}`,
      input: { finding_id: finding.id, buyer_intent_id: finding.buyer_intent_id, version: nextVersion, model },
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start Blueprint generation' }, 400)

    try {
      await ctx.supabase.from('research_jobs').update({ progress: 35, stage: 'generating_implementation_blueprint' }).eq('id', job.id)
      const openai = new OpenAI({ apiKey })
      const response = await openai.responses.create({
        model,
        reasoning: { effort: 'high' },
        instructions: `You are the Implementation Blueprint engine for Riseklix Commercial Discovery.\n\nA human has approved a WHY finding and explicitly decided that a fix is justified. Convert that exact evidence-backed gap into a deployable implementation specification. Do not broaden the scope merely to create more work.\n\nRules:\n1. Every recommendation must trace back to the approved finding, Buyer Intent, or supplied evidence.\n2. Do not invent company claims, certifications, locations, SLAs, fleet sizes, case studies, customers, performance numbers or capabilities. Put anything needed but not established into claims_to_verify or evidence_required.\n3. Prefer upgrading an existing relevant page when the supplied first-party evidence shows one can carry the buying situation. Propose a new page only when the information architecture genuinely lacks an appropriate destination.\n4. For target_mode=existing_page, target_url must be one of the supplied first-party URLs. For target_mode=new_page, use a same-domain URL or path.\n5. Do not recommend schema types merely because they exist. structured_data.prerequisites must state what facts/content must actually be present before markup is appropriate. Empty recommended_types is valid.\n6. required_sections are implementation requirements, not generic SEO headings. They should answer the buyer's decision: capability, commercial model, geography, delivery/service lifecycle, proof, limits, procurement details or other relevant evidence.\n7. opening_answer is a concise answer-first passage that may be used near the top of a page, but it must not contain unverified claims.\n8. Internal links must connect existing supplied URLs to the target when evidence supports a useful relationship. Do not invent source URLs. For a new target, to_url may be the proposed target path.\n9. acceptance_criteria must be objectively reviewable by Riseklix later. Include evidence presence and deployment checks separately from future AI outcome checks.\n10. measurement_plan must not promise causality. It should say what delivery will be verified and which frozen Buyer Intent/prompt panel should be rechecked afterward.\n11. No pricing or service upsell belongs in the Blueprint. Execution routing happens separately.\n12. source_refs may contain only supplied refs.`,
        input: `Target company and project:\n${JSON.stringify({ company: profile.company_name, domain: project.domain, market: project.market, profile })}\n\nApproved Buyer Intent:\n${JSON.stringify(intent)}\n\nApproved WHY finding:\n${JSON.stringify(finding)}\n\nIntent-specific competitors:\n${JSON.stringify(competitors ?? [])}\n\nEvidence sources:\n${JSON.stringify(evidenceSources)}`,
        text: { format: { type: 'json_schema', name: 'riseklix_implementation_blueprint', strict: true, schema: BLUEPRINT_SCHEMA } },
      })

      const raw = outputText(response)
      if (!raw) throw new Error('Blueprint model returned no structured output')
      const parsed = JSON.parse(raw) as BlueprintOutput
      if (!targetAllowed(parsed.target_mode, parsed.target_url, project.domain, firstPartyUrls)) throw new Error('Blueprint proposed a target URL that is not supported by the supplied site evidence')

      const sourceRefs = filterRefs(parsed.source_refs, validSourceIds)
      const requiredSections = parsed.required_sections.map((section) => ({ ...section, source_refs: filterRefs(section.source_refs, validSourceIds) }))
      const evidenceRequired = parsed.evidence_required.map((item) => ({ ...item, source_refs: filterRefs(item.source_refs, validSourceIds) }))
      const validExistingUrls = firstPartyUrls
      const internalLinks = parsed.internal_links.filter((link) => {
        const from = link.from_url.replace(/\/$/, '')
        if (!validExistingUrls.has(link.from_url) && !validExistingUrls.has(from)) return false
        if (parsed.target_mode === 'existing_page') return validExistingUrls.has(link.to_url) || validExistingUrls.has(link.to_url.replace(/\/$/, ''))
        return link.to_url === parsed.target_url
      })

      const { data: blueprint, error: insertError } = await ctx.supabase.from('blueprints').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        finding_id: finding.id,
        generation_job_id: job.id,
        source_refs: sourceRefs,
        version: nextVersion,
        status: 'draft',
        title: parsed.title,
        objective: parsed.objective,
        target_url: parsed.target_url || null,
        suggested_h1: parsed.suggested_h1 || null,
        required_sections: requiredSections,
        evidence_required: evidenceRequired,
        claims_to_verify: parsed.claims_to_verify,
        internal_links: internalLinks,
        structured_data: parsed.structured_data,
        acceptance_criteria: parsed.acceptance_criteria,
        generated_content: {
          target_mode: parsed.target_mode,
          implementation_brief: parsed.implementation_brief,
          opening_answer: parsed.opening_answer,
          content_notes: parsed.content_notes,
          technical_notes: parsed.technical_notes,
          measurement_plan: parsed.measurement_plan,
          buyer_intent_id: intent.id,
          buyer_intent_key: intent.intent_key,
          benchmark_id: finding.benchmark_id,
        },
      }).select('id,version,title,status').single()

      if (insertError || !blueprint) throw insertError ?? new Error('Could not store Blueprint')

      const links = sourceRefs.map((sourceId) => ({
        workspace_id: project.workspace_id,
        project_id: project.id,
        source_id: sourceId,
        entity_type: 'blueprint',
        entity_id: blueprint.id,
        relation: 'context',
        claim_text: `Evidence context used to generate Blueprint v${blueprint.version}.`,
      }))
      if (links.length) await ctx.supabase.from('evidence_links').insert(links)

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded', progress: 100, stage: 'blueprint_ready_for_review',
        output: { model, blueprint_id: blueprint.id, version: blueprint.version, title: blueprint.title, review_required: true },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      await ctx.supabase.from('audit_events').insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_user_id: userId,
        event_type: 'blueprint_generated',
        entity_type: 'blueprint',
        entity_id: blueprint.id,
        payload: { finding_id: finding.id, buyer_intent_id: intent.id, version: blueprint.version, model },
      })

      return json({ blueprint, review_required: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Blueprint generation error'
      await ctx.supabase.from('research_jobs').update({ status: 'failed', progress: 100, stage: 'blueprint_generation_failed', error: { message, model }, completed_at: new Date().toISOString() }).eq('id', job.id)
      await ctx.supabase.from('review_queue_items').insert({ workspace_id: project.workspace_id, project_id: project.id, research_job_id: job.id, entity_type: 'finding', entity_id: finding.id, priority: 'high', reason: `Blueprint generation failed: ${message}`, status: 'open' })
      return json({ error: message, job_id: job.id }, 422)
    }
  }),
}

export default handler
