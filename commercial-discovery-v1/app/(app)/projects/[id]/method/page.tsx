import { createClient } from '@/lib/supabase/server'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default async function MethodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: profile },
    { data: intents },
    { data: prompts },
    { data: benchmarks },
    { data: surfaces },
    { data: observations },
    { data: sources },
    { data: usageEvents },
  ] = await Promise.all([
    supabase.from('projects').select('name,domain,market,primary_language,enabled_languages,provider_mode,status').eq('id', id).single(),
    supabase.from('company_profile_versions').select('version,status,approved_at').eq('project_id', id).eq('is_current', true).maybeSingle(),
    supabase.from('buyer_intents').select('id,status,provenance').eq('project_id', id),
    supabase.from('prompt_expressions').select('id,status,mode,language,is_frozen,version').eq('project_id', id),
    supabase.from('benchmarks').select('id,benchmark_type,version,status,collection_config,created_at,completed_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('benchmark_surfaces').select('id,benchmark_id,provider,surface,model_label,status,expected_runs,captured_runs,error_runs,metadata').eq('project_id', id).order('created_at'),
    supabase.from('observation_runs').select('id,benchmark_id,provider,surface,run_status,retrieval_status,language,metadata').eq('project_id', id),
    supabase.from('research_sources').select('id,source_type,captured_at').eq('project_id', id),
    supabase.from('ai_usage_events').select('stage,model,service_tier,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,reasoning_tokens,web_search_calls,estimated_total_cost_usd,created_at').eq('project_id', id).order('created_at'),
  ])

  const approvedIntents = intents?.filter((intent) => intent.status === 'approved').length ?? 0
  const candidateIntents = intents?.filter((intent) => intent.status === 'candidate').length ?? 0
  const approvedPrompts = prompts?.filter((prompt) => prompt.status === 'approved').length ?? 0
  const frozenPrompts = prompts?.filter((prompt) => prompt.is_frozen).length ?? 0
  const captured = observations?.filter((run) => run.run_status === 'captured').length ?? 0
  const errors = observations?.filter((run) => run.run_status === 'error').length ?? 0
  const nr = observations?.filter((run) => run.run_status === 'captured' && run.retrieval_status === 'nr').length ?? 0
  const retrieved = observations?.filter((run) => run.run_status === 'captured' && run.retrieval_status === 'retrieved').length ?? 0
  const latestBenchmark = benchmarks?.[0]
  const latestConfig = record(latestBenchmark?.collection_config)
  const latestSurfaces = latestBenchmark ? (surfaces ?? []).filter((surface) => surface.benchmark_id === latestBenchmark.id) : []
  const measuredCost = (usageEvents ?? []).reduce((sum, event) => sum + Number(event.estimated_total_cost_usd || 0), 0)
  const measuredInputTokens = (usageEvents ?? []).reduce((sum, event) => sum + Number(event.input_tokens || 0), 0)
  const measuredCachedTokens = (usageEvents ?? []).reduce((sum, event) => sum + Number(event.cached_input_tokens || 0), 0)
  const measuredOutputTokens = (usageEvents ?? []).reduce((sum, event) => sum + Number(event.output_tokens || 0), 0)
  const measuredSearchCalls = (usageEvents ?? []).reduce((sum, event) => sum + Number(event.web_search_calls || 0), 0)
  const usageByStage = new Map<string, { calls: number; cost: number }>()
  for (const event of usageEvents ?? []) {
    const current = usageByStage.get(event.stage) ?? { calls: 0, cost: 0 }
    current.calls += 1
    current.cost += Number(event.estimated_total_cost_usd || 0)
    usageByStage.set(event.stage, current)
  }
  const usageStages = Array.from(usageByStage.entries()).sort((a, b) => b[1].cost - a[1].cost)

  return (
    <div className="project-page method-page">
      <section className="page-header compact">
        <div>
          <div className="eyebrow">METHOD + AUDIT TRAIL</div>
          <h1>How this project is being measured.</h1>
          <p>Riseklix keeps methodology close enough to inspect, but out of the way of normal decision-making. This page records the rules behind the conclusions.</p>
        </div>
      </section>

      <section className="method-status-grid">
        <div><span>Company profile</span><strong>v{profile?.version ?? '—'} · {profile?.status ?? 'missing'}</strong><small>{profile?.approved_at ? 'Approved ' + new Date(profile.approved_at).toLocaleDateString() : 'Approval pending'}</small></div>
        <div><span>Buyer Situations</span><strong>{approvedIntents} approved</strong><small>{candidateIntents} still awaiting review</small></div>
        <div><span>Question expressions</span><strong>{approvedPrompts} approved</strong><small>{frozenPrompts} currently frozen</small></div>
        <div><span>Observation evidence</span><strong>{captured} captured</strong><small>{errors} capture errors</small></div>
      </section>

      <section className="method-chapter">
        <div className="method-chapter-number">01</div>
        <div>
          <div className="eyebrow">PROJECT CONDITIONS</div>
          <h2>What this benchmark is actually about.</h2>
          <div className="method-facts">
            <div><span>Company</span><strong>{project?.name}</strong></div>
            <div><span>Domain</span><strong>{project?.domain}</strong></div>
            <div><span>Primary market</span><strong>{project?.market}</strong></div>
            <div><span>Primary language</span><strong>{project?.primary_language}</strong></div>
            <div><span>Enabled languages</span><strong>{Array.isArray(project?.enabled_languages) ? project.enabled_languages.join(' · ') : '—'}</strong></div>
            <div><span>Provider mode</span><strong>{project?.provider_mode}</strong></div>
          </div>
        </div>
      </section>

      <section className="method-chapter">
        <div className="method-chapter-number">02</div>
        <div>
          <div className="eyebrow">MEASUREMENT RULES</div>
          <h2>What counts — and what does not.</h2>
          <div className="method-rule-grid">
            <article><strong>Retrieval</strong><p>The target company explicitly appears in the recommended or shortlisted provider set for a captured answer.</p></article>
            <article><strong>Rank</strong><p>Response-order position among identifiable recommended providers. It is directional because answer formats differ.</p></article>
            <article><strong>NR · Not Retrieved</strong><p>The answer was captured successfully, but the target did not enter the tracked recommendation set.</p></article>
            <article><strong>NC / capture failure</strong><p>The run was not captured successfully. It is missing evidence, not a negative recommendation.</p></article>
            <article><strong>Aided control</strong><p>The company is named to test comprehension. Aided results never count toward unaided discovery visibility.</p></article>
            <article><strong>Before / after</strong><p>Observed change is reported. Direct causality is not claimed automatically because models, competitors and public evidence can change concurrently.</p></article>
          </div>
        </div>
      </section>

      <section className="method-chapter">
        <div className="method-chapter-number">03</div>
        <div>
          <div className="eyebrow">CURRENT BENCHMARK</div>
          <h2>{latestBenchmark ? latestBenchmark.benchmark_type + ' v' + latestBenchmark.version : 'No benchmark frozen yet.'}</h2>
          {latestBenchmark ? (
            <>
              <div className="method-facts">
                <div><span>Status</span><strong>{latestBenchmark.status}</strong></div>
                <div><span>Prompt count</span><strong>{typeof latestConfig.prompt_count === 'number' ? latestConfig.prompt_count : '—'}</strong></div>
                <div><span>Buyer intents</span><strong>{typeof latestConfig.intent_count === 'number' ? latestConfig.intent_count : '—'}</strong></div>
                <div><span>Repetitions</span><strong>{typeof latestConfig.repetitions_per_expression === 'number' ? latestConfig.repetitions_per_expression : '—'}</strong></div>
                <div><span>Session policy</span><strong>{typeof latestConfig.session_policy === 'string' ? latestConfig.session_policy.replaceAll('_', ' ') : '—'}</strong></div>
                <div><span>Frozen questions</span><strong>{frozenPrompts}</strong></div>
              </div>

              <div className="method-surface-list">
                {latestSurfaces.map((surface) => {
                  const meta = record(surface.metadata)
                  return (
                    <article key={surface.id}>
                      <div>
                        <span>{surface.provider}</span>
                        <strong>{typeof meta.display_name === 'string' ? meta.display_name : surface.surface}</strong>
                        <small>{typeof meta.methodology_note === 'string' ? meta.methodology_note : 'Declared observation surface.'}</small>
                      </div>
                      <div>
                        <strong>{surface.status.replaceAll('_', ' ')}</strong>
                        <small>{surface.captured_runs}/{surface.expected_runs || '—'} captured · {surface.error_runs} errors</small>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          ) : <p className="method-muted">The benchmark becomes auditable after approved unaided + aided question expressions are frozen.</p>}
        </div>
      </section>

      <section className="method-chapter">
        <div className="method-chapter-number">04</div>
        <div>
          <div className="eyebrow">EVIDENCE LINEAGE</div>
          <h2>Every conclusion should be traceable backward.</h2>
          <div className="lineage-path">
            <span>Company evidence</span><i>→</i><span>Buyer Intent</span><i>→</i><span>Competitor set</span><i>→</i><span>Prompt expression</span><i>→</i><span>Observation</span><i>→</i><span>WHY finding</span><i>→</i><span>Blueprint</span>
          </div>
          <div className="method-mini-stats">
            <div><strong>{sources?.length ?? 0}</strong><span>research sources</span></div>
            <div><strong>{retrieved}</strong><span>captured retrievals</span></div>
            <div><strong>{nr}</strong><span>captured NR observations</span></div>
          </div>
        </div>
      </section>

      <section className="method-chapter">
        <div className="method-chapter-number">05</div>
        <div>
          <div className="eyebrow">AI COST TELEMETRY</div>
          <h2>Measured provider usage for this project.</h2>
          <p className="method-muted">This ledger records OpenAI token and tool usage from calls made after cost telemetry was enabled. It is separate from safety counters and does not retroactively reconstruct older spend.</p>
          <div className="method-facts">
            <div><span>Measured OpenAI cost</span><strong>{usageEvents?.length ? 'USD ' + measuredCost.toFixed(4) : 'Not measured yet'}</strong></div>
            <div><span>API calls logged</span><strong>{usageEvents?.length ?? 0}</strong></div>
            <div><span>Input tokens</span><strong>{measuredInputTokens.toLocaleString()}</strong></div>
            <div><span>Cached input</span><strong>{measuredCachedTokens.toLocaleString()}</strong></div>
            <div><span>Output tokens</span><strong>{measuredOutputTokens.toLocaleString()}</strong></div>
            <div><span>Web-search calls</span><strong>{measuredSearchCalls}</strong></div>
          </div>
          {!!usageStages.length && (
            <div className="method-surface-list">
              {usageStages.map(([stage, usage]) => (
                <article key={stage}>
                  <div>
                    <span>OpenAI stage</span>
                    <strong>{stage.replaceAll('_', ' ')}</strong>
                    <small>{usage.calls} logged call{usage.calls === 1 ? '' : 's'}</small>
                  </div>
                  <div>
                    <strong>{'USD ' + usage.cost.toFixed(4)}</strong>
                    <small>estimated from recorded tokens + tool calls</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="method-warning">
        <div className="eyebrow">INTERPRETATION BOUNDARY</div>
        <h2>Model output is evidence about model behavior — not ground truth about the company.</h2>
        <p>Capabilities, certifications, client claims and service coverage require source verification. WHY findings are evidence-bounded interpretations and Blueprints must keep unverified claims visibly unresolved.</p>
      </section>
    </div>
  )
}
