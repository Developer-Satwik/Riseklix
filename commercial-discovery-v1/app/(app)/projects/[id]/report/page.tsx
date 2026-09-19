import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PendingButton } from '@/components/pending-button'
import { generatePriorityFixes } from './actions'

function pct(hit: number, total: number) {
  return total ? Math.round((hit / total) * 100) : 0
}

function severityRank(value: string) {
  return value === 'critical' ? 0 : value === 'high' ? 1 : value === 'medium' ? 2 : 3
}

function providerLabel(value: string) {
  if (value === 'openai') return 'OpenAI'
  if (value === 'google') return 'Gemini'
  if (value === 'anthropic') return 'Claude'
  if (value === 'perplexity') return 'Perplexity'
  return value
}

function brandName(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === 'string' ? name.trim() : null
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: profile },
    { data: benchmark },
    { data: intents },
    { data: prompts },
    { data: observations },
    { data: surfaces },
    { data: findings },
    { data: competitors },
    { data: blueprints },
    { data: sources },
    { data: autopilotRun },
  ] = await Promise.all([
    supabase.from('projects').select('id,name,domain,market,status,analysis_mode,primary_language,updated_at').eq('id', id).single(),
    supabase.from('company_profile_versions').select('company_name,industry,business_model,summary,products,services,audiences,geographies,uncertainty').eq('project_id', id).eq('is_current', true).maybeSingle(),
    supabase.from('benchmarks').select('id,status,version,benchmark_type,created_at,completed_at,collection_config').eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('buyer_intents').select('id,intent_key,title,buyer,job_to_be_done,priority,status,provenance,provenance_reason').eq('project_id', id).eq('status', 'approved').order('created_at'),
    supabase.from('prompt_expressions').select('id,buyer_intent_id,mode,language,prompt_text,status').eq('project_id', id).eq('status', 'approved'),
    supabase.from('observation_runs').select('id,benchmark_id,buyer_intent_id,prompt_expression_id,provider,run_status,retrieval_status,target_rank,extracted_brands,citations,error_message,captured_at').eq('project_id', id),
    supabase.from('benchmark_surfaces').select('benchmark_id,provider,surface,status,expected_runs,captured_runs,error_runs,metadata').eq('project_id', id).eq('enabled', true),
    supabase.from('findings').select('id,buyer_intent_id,finding_type,severity,decision,observed,aided_control,competitor_pattern,client_evidence,counter_evidence,explanation,evidence_strength,review_status,is_current').eq('project_id', id).eq('is_current', true),
    supabase.from('competitor_candidates').select('id,buyer_intent_id,company_name,domain,relationship,evidence_strength,rationale,is_current,status').eq('project_id', id).eq('is_current', true).eq('status', 'verified'),
    supabase.from('blueprints').select('id,finding_id,status,version,title').eq('project_id', id),
    supabase.from('research_sources').select('id,url,title,source_type,captured_at').eq('project_id', id).order('captured_at', { ascending: false }).limit(30),
    supabase.from('autopilot_runs').select('status,stage,progress,completed_at').eq('project_id', id).maybeSingle(),
  ])

  if (!project) redirect('/projects')
  if (
    project.analysis_mode === 'autopilot'
    && autopilotRun?.status !== 'complete'
    && autopilotRun?.stage !== 'evaluation_complete'
  ) {
    redirect('/projects/' + id + '/processing')
  }

  const promptById = new Map((prompts ?? []).map((prompt) => [prompt.id, prompt]))
  const intentById = new Map((intents ?? []).map((intent) => [intent.id, intent]))
  const benchmarkObservations = (observations ?? []).filter((run) => !benchmark?.id || run.benchmark_id === benchmark.id)
  const benchmarkSurfaces = (surfaces ?? []).filter((surface) => !benchmark?.id || surface.benchmark_id === benchmark.id)
  const captured = benchmarkObservations.filter((run) => run.run_status === 'captured')
  const unaided = captured.filter((run) => promptById.get(run.prompt_expression_id)?.mode === 'unaided')
  const aided = captured.filter((run) => promptById.get(run.prompt_expression_id)?.mode === 'aided')
  const unaidedRetrieved = unaided.filter((run) => run.retrieval_status === 'retrieved')
  const aidedRetrieved = aided.filter((run) => run.retrieval_status === 'retrieved')
  const ranked = unaidedRetrieved.map((run) => run.target_rank).filter((value): value is number => typeof value === 'number')
  const avgRank = ranked.length ? (ranked.reduce((sum, value) => sum + value, 0) / ranked.length).toFixed(1) : null

  const capturedErrors = benchmarkObservations.filter((run) => run.run_status === 'error').length
  const minimumUsableProviders = 3
  const usableSurfaces = benchmarkSurfaces.filter((surface) => {
    const expectedRuns = Number(surface.expected_runs || 0)
    const capturedRuns = Number(surface.captured_runs || 0)
    return capturedRuns >= Math.max(1, Math.ceil(expectedRuns * 0.5))
  })
  const usableProviderSet = new Set(usableSurfaces.map((surface) => surface.provider))
  const excludedSurfaces = benchmarkSurfaces.filter((surface) => !usableProviderSet.has(surface.provider))
  const actionFindings = (findings ?? [])
    .filter((finding) => finding.review_status === 'approved' && finding.decision === 'fix')
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  const investigateFindings = (findings ?? []).filter((finding) => finding.decision === 'investigate')
  const healthyFindings = (findings ?? []).filter((finding) => finding.decision === 'healthy' || finding.decision === 'no_change')
  const blueprintFindingIds = new Set((blueprints ?? []).map((blueprint) => blueprint.finding_id))

  const providerStats = Array.from(new Set(unaided.map((run) => run.provider))).map((provider) => {
    const rows = unaided.filter((run) => run.provider === provider)
    const hits = rows.filter((run) => run.retrieval_status === 'retrieved').length
    const providerRanks = rows.map((run) => run.target_rank).filter((value): value is number => typeof value === 'number')
    return {
      provider,
      total: rows.length,
      hits,
      avgRank: providerRanks.length ? (providerRanks.reduce((sum, value) => sum + value, 0) / providerRanks.length).toFixed(1) : null,
    }
  })

  const target = (profile?.company_name || project.name).toLowerCase()
  const domainStem = project.domain.split('.')[0]?.toLowerCase() || ''
  const brandCounts = new Map<string, number>()
  for (const run of unaided) {
    const brands = Array.isArray(run.extracted_brands) ? run.extracted_brands : []
    const seen = new Set<string>()
    for (const item of brands) {
      const name = brandName(item)
      if (!name) continue
      const normalized = name.toLowerCase()
      if (normalized === target || normalized.includes(target) || (domainStem && normalized.includes(domainStem))) continue
      if (seen.has(normalized)) continue
      seen.add(normalized)
      brandCounts.set(name, (brandCounts.get(name) ?? 0) + 1)
    }
  }
  const topBrands = Array.from(brandCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)

  const intentRows = (intents ?? []).map((intent) => {
    const rows = captured.filter((run) => run.buyer_intent_id === intent.id)
    const intentUnaided = rows.filter((run) => promptById.get(run.prompt_expression_id)?.mode === 'unaided')
    const intentAided = rows.filter((run) => promptById.get(run.prompt_expression_id)?.mode === 'aided')
    const unaidedHits = intentUnaided.filter((run) => run.retrieval_status === 'retrieved').length
    const aidedHits = intentAided.filter((run) => run.retrieval_status === 'retrieved').length
    return { ...intent, unaidedTotal: intentUnaided.length, unaidedHits, aidedTotal: intentAided.length, aidedHits }
  })

  const priorityCounts = actionFindings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="project-page report-page">
      <section className="report-cover">
        <div>
          <div className="eyebrow">AI COMMERCIAL DISCOVERY REPORT</div>
          <h1>{profile?.company_name || project.name}</h1>
          <p className="report-thesis">
            {actionFindings[0]?.explanation
              || investigateFindings[0]?.explanation
              || healthyFindings[0]?.explanation
              || 'The benchmark is complete. Review the retrieval evidence before deciding what deserves implementation.'}
          </p>
        </div>
        <div className="report-cover-meta">
          <span>{project.market}</span>
          <span>{project.primary_language}</span>
          <span>{benchmark?.completed_at ? new Date(benchmark.completed_at).toLocaleDateString() : new Date(project.updated_at).toLocaleDateString()}</span>
        </div>
      </section>

      <nav className="report-anchor-nav" aria-label="Report sections">
        <a href="#diagnosis">Diagnosis</a>
        <a href="#situations">Buyer situations</a>
        <a href="#engines">AI systems</a>
        <a href="#competitors">Competitors</a>
        <a href="#findings">WHY</a>
        <a href="#fix-plan">Fix plan</a>
        <a href="#method">Method</a>
      </nav>

      <section className="report-metric-strip">
        <div>
          <span>Unaided retrieval</span>
          <strong>{unaidedRetrieved.length}/{unaided.length}</strong>
          <small>{pct(unaidedRetrieved.length, unaided.length)}% of captured problem-first runs</small>
        </div>
        <div>
          <span>Aided controls</span>
          <strong>{aidedRetrieved.length}/{aided.length}</strong>
          <small>{pct(aidedRetrieved.length, aided.length)}% when the company is named</small>
        </div>
        <div>
          <span>Average rank when surfaced</span>
          <strong>{avgRank ? '#' + avgRank : '—'}</strong>
          <small>Surfaced unaided runs only</small>
        </div>
        <div>
          <span>Action justified</span>
          <strong>{actionFindings.length}</strong>
          <small>{actionFindings.length ? 'Finding' + (actionFindings.length === 1 ? '' : 's') + ' support a fix' : 'No work manufactured'}</small>
        </div>
      </section>

      <section className="report-section report-diagnosis" id="diagnosis">
        <header>
          <div className="eyebrow">01 / CORE DIAGNOSIS</div>
          <h2>What the benchmark says before we prescribe anything.</h2>
        </header>

        <div className="report-diagnosis-grid">
          <article className="report-company-card">
            <span>Confirmed company premise</span>
            <h3>{profile?.summary || 'Company profile confirmed before benchmark generation.'}</h3>
            <div>
              {profile?.industry && <small>{profile.industry}</small>}
              {profile?.business_model && <small>{profile.business_model}</small>}
            </div>
          </article>

          <article className="report-decision-card">
            <span>Decision read</span>
            <h3>
              {actionFindings.length
                ? actionFindings.length + ' evidence-supported change' + (actionFindings.length === 1 ? '' : 's') + ' deserve prioritization.'
                : investigateFindings.length
                  ? 'The benchmark found signals worth investigating, but not enough evidence to manufacture implementation work.'
                  : 'The current evidence does not justify a fix.'}
            </h3>
            <p>Riseklix keeps observed model behavior, interpretation and implementation as separate layers. A failed provider run is not counted as a non-recommendation.</p>
          </article>
        </div>

        {!!findings?.length && (
          <div className="report-finding-ledger">
            {(findings ?? []).sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).map((finding) => {
              const intent = finding.buyer_intent_id ? intentById.get(finding.buyer_intent_id) : null
              return (
                <article key={finding.id}>
                  <div>
                    <span className={'report-decision-pill ' + finding.decision}>{finding.decision.replaceAll('_', ' ')}</span>
                    <small>{finding.severity} · {finding.evidence_strength} evidence</small>
                  </div>
                  <h3>{intent?.title || finding.finding_type.replaceAll('_', ' ')}</h3>
                  <p>{finding.observed}</p>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="report-section" id="situations">
        <header>
          <div className="eyebrow">02 / BUYER-SITUATION RETRIEVAL</div>
          <h2>Where the company enters consideration—and where it disappears.</h2>
          <p>Each row keeps unaided discovery separate from the named-brand control so category retrieval is not confused with simple entity comprehension.</p>
        </header>

        <div className="report-intent-table">
          <div className="report-table-head"><span>Buyer situation</span><span>Unaided</span><span>Aided</span><span>Priority</span></div>
          {intentRows.map((intent) => (
            <article key={intent.id}>
              <div>
                <small>{intent.intent_key}</small>
                <strong>{intent.title}</strong>
                <p>{intent.job_to_be_done}</p>
              </div>
              <div><strong>{intent.unaidedHits}/{intent.unaidedTotal}</strong><small>{intent.unaidedTotal ? pct(intent.unaidedHits, intent.unaidedTotal) + '%' : 'No capture'}</small></div>
              <div><strong>{intent.aidedHits}/{intent.aidedTotal}</strong><small>{intent.aidedTotal ? pct(intent.aidedHits, intent.aidedTotal) + '%' : 'No capture'}</small></div>
              <span className={'report-priority ' + intent.priority}>{intent.priority}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="report-section" id="engines">
        <header>
          <div className="eyebrow">03 / ENGINE VARIANCE</div>
          <h2>The same company can route very differently across AI systems.</h2>
        </header>

        <div className="report-engine-grid">
          {providerStats.map((stat) => (
            <article key={stat.provider}>
              <span>{providerLabel(stat.provider)}</span>
              <strong>{stat.hits}/{stat.total}</strong>
              <p>Unaided retrieval</p>
              <small>{stat.avgRank ? 'Average surfaced rank #' + stat.avgRank : 'No surfaced rank in captured runs'}</small>
            </article>
          ))}
          {excludedSurfaces.map((surface) => (
            <article key={'excluded-' + surface.provider}>
              <span>{providerLabel(surface.provider)}</span>
              <strong>Excluded</strong>
              <p>{surface.status === 'failed' ? 'Capture failed' : 'Insufficient usable capture'}</p>
              <small>{surface.captured_runs}/{surface.expected_runs} captured · {surface.error_runs} error{surface.error_runs === 1 ? '' : 's'}</small>
            </article>
          ))}
          {!providerStats.length && !excludedSurfaces.length && <p>No captured unaided observation runs are available.</p>}
        </div>

        <div className="report-capture-note">
          <strong>{usableSurfaces.length} of {benchmarkSurfaces.length} AI systems included</strong>
          <span>{usableSurfaces.length >= minimumUsableProviders ? 'Minimum cross-model coverage met.' : 'Minimum cross-model coverage was not met.'}</span>
          <span>{capturedErrors} provider/capture error{capturedErrors === 1 ? '' : 's'} kept outside retrieval denominators.</span>
          {!!excludedSurfaces.length && <span>{excludedSurfaces.map((surface) => providerLabel(surface.provider)).join(', ')} excluded from aggregate interpretation because usable capture was insufficient.</span>}
        </div>
      </section>

      <section className="report-section" id="competitors">
        <header>
          <div className="eyebrow">04 / COMPETITOR BATTLEFIELD</div>
          <h2>Which names keep occupying the recommendation set?</h2>
          <p>Appearance counts are directional observations inside this benchmark, not market share and not an endorsement.</p>
        </header>

        <div className="report-competitor-grid">
          {topBrands.map(([name, count], index) => (
            <article key={name}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{name}</strong>
              <b>{count}</b>
            </article>
          ))}
          {!topBrands.length && (competitors ?? []).slice(0, 8).map((competitor, index) => (
            <article key={competitor.id}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{competitor.company_name}</strong>
              <b>verified</b>
            </article>
          ))}
        </div>

        {!!competitors?.length && (
          <details className="report-detail-drawer">
            <summary>Open intent-specific competitor evidence</summary>
            <div>
              {competitors.slice(0, 16).map((competitor) => (
                <article key={competitor.id}>
                  <strong>{competitor.company_name}</strong>
                  <span>{competitor.relationship.replaceAll('_', ' ')} · {competitor.evidence_strength} evidence</span>
                  <p>{competitor.rationale}</p>
                </article>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="report-section" id="findings">
        <header>
          <div className="eyebrow">05 / WHY LAYER</div>
          <h2>Observed behavior first. Explanations second.</h2>
          <p>These interpretations are evidence-bounded hypotheses, not claims of proven causation.</p>
        </header>

        <div className="report-why-stack">
          {(findings ?? []).map((finding) => {
            const intent = finding.buyer_intent_id ? intentById.get(finding.buyer_intent_id) : null
            return (
              <article key={finding.id}>
                <header>
                  <div><span>{finding.decision.replaceAll('_', ' ')}</span><small>{finding.evidence_strength} evidence</small></div>
                  <strong>{intent?.title || finding.finding_type.replaceAll('_', ' ')}</strong>
                </header>
                <div>
                  <section><small>Observed</small><p>{finding.observed}</p></section>
                  <section><small>Possible explanation</small><p>{finding.explanation || 'More evidence required.'}</p></section>
                  <section><small>What argues against it</small><p>{finding.counter_evidence || 'No counter-evidence recorded.'}</p></section>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="report-section report-fix-plan" id="fix-plan">
        <header>
          <div className="eyebrow">06 / PRIORITIZED FIX PLAN</div>
          <h2>Generate the work in the order the evidence justifies it.</h2>
          <p>No price cards. No forced implementation route. First generate the exact Blueprint, review the scope and evidence requirements, then decide whether you, your team, a specialist or Riseklix executes it.</p>
        </header>

        {actionFindings.length ? (
          <>
            <div className="report-priority-summary">
              <div><span>Critical</span><strong>{priorityCounts.critical ?? 0}</strong></div>
              <div><span>High</span><strong>{priorityCounts.high ?? 0}</strong></div>
              <div><span>Medium</span><strong>{priorityCounts.medium ?? 0}</strong></div>
              <div><span>Low</span><strong>{priorityCounts.low ?? 0}</strong></div>
            </div>

            <div className="report-fix-options">
              <form action={generatePriorityFixes}>
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="scope" value="critical" />
                <span>01</span>
                <h3>Critical only</h3>
                <p>Generate only the changes tied to critical findings. Best when you want the narrowest possible first move.</p>
                <PendingButton pendingLabel="Generating critical fixes…">Generate critical fixes</PendingButton>
              </form>
              <form action={generatePriorityFixes}>
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="scope" value="high" />
                <span>02</span>
                <h3>Critical + high</h3>
                <p>Build the highest-priority implementation set before touching medium-signal issues.</p>
                <PendingButton pendingLabel="Generating priority fixes…">Generate priority fixes</PendingButton>
              </form>
              <form action={generatePriorityFixes}>
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="scope" value="all" />
                <span>03</span>
                <h3>All justified fixes</h3>
                <p>Generate every currently approved “fix” Blueprint, still keeping each one separate for review.</p>
                <PendingButton pendingLabel="Generating all fixes…">Generate all justified fixes</PendingButton>
              </form>
            </div>

            <div className="report-fix-ledger">
              {actionFindings.map((finding) => {
                const intent = finding.buyer_intent_id ? intentById.get(finding.buyer_intent_id) : null
                const generated = blueprintFindingIds.has(finding.id)
                return (
                  <article key={finding.id}>
                    <span className={'report-priority ' + finding.severity}>{finding.severity}</span>
                    <div><strong>{intent?.title || finding.finding_type.replaceAll('_', ' ')}</strong><p>{finding.explanation}</p></div>
                    <small>{generated ? 'Blueprint generated' : 'Ready to generate'}</small>
                  </article>
                )
              })}
            </div>

            <Link href={'/projects/' + id + '/fixes'} className="report-open-fixes">Open Blueprint workspace →</Link>
          </>
        ) : (
          <div className="report-no-fix">
            <h3>No implementation work is justified yet.</h3>
            <p>The system will not manufacture a roadmap simply because an analysis exists. Investigate or monitor findings stay diagnostic until evidence supports a change.</p>
          </div>
        )}
      </section>

      <section className="report-section" id="method">
        <header>
          <div className="eyebrow">07 / METHOD & EVIDENCE</div>
          <h2>What this report does—and does not—claim.</h2>
        </header>
        <div className="report-method-grid">
          <article><strong>Fresh-session testing</strong><p>Approved questions are run independently so one model answer cannot contaminate the next buyer situation.</p></article>
          <article><strong>NR is not a failed capture</strong><p>Non-retrieval is recorded only when a usable answer was captured. Provider errors stay separate.</p></article>
          <article><strong>Unaided ≠ aided</strong><p>Problem-first discovery and named-brand controls answer different questions and are not merged into one rate.</p></article>
          <article><strong>Retrieval ≠ quality</strong><p>A model mentioning or ranking a company is not evidence that the company is objectively better than an alternative.</p></article>
        </div>

        {!!sources?.length && (
          <details className="report-detail-drawer">
            <summary>{sources.length} preserved research source{sources.length === 1 ? '' : 's'}</summary>
            <div>
              {sources.map((source) => (
                <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                  <strong>{source.title || source.url}</strong>
                  <span>{source.source_type.replaceAll('_', ' ')}</span>
                </a>
              ))}
            </div>
          </details>
        )}

        <div className="report-method-footer">
          <Link href={'/projects/' + id + '/method'}>Open full methodology →</Link>
          <Link href={'/projects/' + id + '/test'}>Inspect prompt-level evidence →</Link>
          <Link href={'/projects/' + id + '/why'}>Inspect full WHY findings →</Link>
        </div>
      </section>
    </div>
  )
}
