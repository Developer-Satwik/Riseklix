import { createClient } from '@/lib/supabase/server'
import { approveFinding, rejectFinding, runWhyEvaluation } from './actions'
import { PendingButton } from '@/components/pending-button'

export default async function WhyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: findings }, { data: intents }, { data: benchmarks }, { data: observations }, { data: sources }] = await Promise.all([
    supabase.from('findings').select('id,benchmark_id,buyer_intent_id,finding_type,severity,decision,observed,aided_control,competitor_pattern,client_evidence,counter_evidence,explanation,evidence_strength,review_status,source_refs,is_current,created_at').eq('project_id', id).eq('is_current', true).order('created_at', { ascending: false }),
    supabase.from('buyer_intents').select('id,intent_key,title,priority').eq('project_id', id),
    supabase.from('benchmarks').select('id,benchmark_type,version,status,created_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('observation_runs').select('id,benchmark_id,buyer_intent_id,run_status').eq('project_id', id),
    supabase.from('research_sources').select('id,title,url,source_type').eq('project_id', id),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const capturedByBenchmark = new Map<string, number>()
  for (const observation of observations ?? []) {
    if (observation.run_status !== 'captured') continue
    capturedByBenchmark.set(observation.benchmark_id, (capturedByBenchmark.get(observation.benchmark_id) ?? 0) + 1)
  }
  const evaluableBenchmark = (benchmarks ?? []).find((benchmark) => (capturedByBenchmark.get(benchmark.id) ?? 0) > 0)
  const benchmarkFindingCount = evaluableBenchmark ? (findings ?? []).filter((finding) => finding.benchmark_id === evaluableBenchmark.id).length : 0
  const capturedIntentCount = evaluableBenchmark
    ? new Set((observations ?? []).filter((run) => run.benchmark_id === evaluableBenchmark.id && run.run_status === 'captured').map((run) => run.buyer_intent_id)).size
    : 0
  const intentById = new Map((intents ?? []).map((intent) => [intent.id, intent]))
  const sourceById = new Map((sources ?? []).map((source) => [source.id, source]))
  const fixCount = (findings ?? []).filter((finding) => finding.decision === 'fix').length
  const investigateCount = (findings ?? []).filter((finding) => finding.decision === 'investigate').length
  const monitorCount = (findings ?? []).filter((finding) => finding.decision === 'monitor').length
  const healthyCount = (findings ?? []).filter((finding) => finding.decision === 'healthy' || finding.decision === 'no_change').length

  return (
    <div className="project-page">
      <section className="page-header compact">
        <div>
          <div className="eyebrow">WHY?</div>
          <h1>What happened, what the evidence supports, and what deserves action.</h1>
          <p>Observed behavior is computed from captured runs. Interpretation comes afterward, counter-evidence is mandatory, and “no change justified” remains a valid result.</p>
        </div>
      </section>

      {error && <div className="form-alert error" role="alert">{error}</div>}
      {message && <div className="form-alert success" role="status" aria-live="polite">{message}</div>}

      <section className={`why-engine-state ${evaluableBenchmark ? 'ready' : ''}`}>
        <div>
          <div className="eyebrow">EVIDENCE-BOUNDED DIAGNOSIS</div>
          <h2>{evaluableBenchmark ? `${capturedByBenchmark.get(evaluableBenchmark.id)} captured observations are available.` : 'Capture a benchmark before asking WHY.'}</h2>
          <p>{evaluableBenchmark ? `${benchmarkFindingCount}/${capturedIntentCount} captured Buyer Intents currently have a WHY finding for ${evaluableBenchmark.benchmark_type} v${evaluableBenchmark.version}. The evaluator receives captured answers, intent-specific competitors and preserved evidence; it does not perform a new fact-finding search.` : 'Riseklix will not create a diagnostic story from an empty benchmark.'}</p>
        </div>
        {evaluableBenchmark && benchmarkFindingCount < capturedIntentCount && (
          <form action={runWhyEvaluation}>
            <input type="hidden" name="project_id" value={id} />
            <input type="hidden" name="benchmark_id" value={evaluableBenchmark.id} />
            <input type="hidden" name="regenerate" value="false" />
            <PendingButton pendingLabel="Evaluating evidence…">Generate next WHY findings</PendingButton>
          </form>
        )}
      </section>

      {!!findings?.length && (
        <section className="why-summary-strip" aria-label="WHY decision summary">
          <div className="fix"><span>Fix</span><strong>{fixCount}</strong><small>Evidence supports testing a change.</small></div>
          <div className="investigate"><span>Investigate</span><strong>{investigateCount}</strong><small>Meaningful signal, more evidence needed.</small></div>
          <div className="monitor"><span>Monitor</span><strong>{monitorCount}</strong><small>Too unstable to justify work yet.</small></div>
          <div className="healthy"><span>Healthy</span><strong>{healthyCount}</strong><small>No change justified right now.</small></div>
        </section>
      )}

      <div className="finding-stack why-findings">
        {(findings ?? []).map((finding) => {
          const intent = finding.buyer_intent_id ? intentById.get(finding.buyer_intent_id) : null
          const refs = Array.isArray(finding.source_refs) ? finding.source_refs.filter((ref): ref is string => typeof ref === 'string') : []
          const evidenceSources = refs.map((ref) => sourceById.get(ref)).filter(Boolean)
          return (
            <article key={finding.id} className="finding-card">
              <header>
                <div className="finding-badges"><span>{finding.finding_type.replaceAll('_', ' ')}</span><span>{finding.severity}</span><span>{finding.evidence_strength} evidence</span><span>{finding.review_status}</span></div>
                <strong>{finding.decision.replaceAll('_', ' ')}</strong>
              </header>
              {intent && <div className="finding-intent"><small>{intent.intent_key} · {intent.priority}</small><h2>{intent.title}</h2></div>}
              <div className="finding-grid">
                <section><small>Observed · deterministic</small><p>{finding.observed}</p></section>
                <section><small>Aided control · deterministic</small><p>{finding.aided_control || 'Not captured'}</p></section>
                <section><small>Competitor pattern · interpretation</small><p>{finding.competitor_pattern || 'Not established'}</p></section>
                <section><small>Your evidence · interpretation</small><p>{finding.client_evidence || 'Not established'}</p></section>
              </div>
              <div className="hypothesis"><small>Possible explanation — not proven cause</small><p>{finding.explanation || 'More evidence required.'}</p></div>
              <div className="counter-evidence"><small>What argues against this explanation</small><p>{finding.counter_evidence || 'No counter-evidence recorded; do not approve until reviewed.'}</p></div>

              {!!evidenceSources.length && (
                <details className="finding-evidence">
                  <summary>{evidenceSources.length} evidence source{evidenceSources.length === 1 ? '' : 's'} used in interpretation</summary>
                  <div>
                    {evidenceSources.map((source) => source && (
                      <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span>{source.source_type.replaceAll('_', ' ')}</span><strong>{source.title || source.url}</strong></a>
                    ))}
                  </div>
                </details>
              )}

              {finding.review_status === 'generated' && (
                <div className="finding-actions">
                  <form action={approveFinding}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="finding_id" value={finding.id} /><PendingButton pendingLabel="Approving…">Approve diagnosis</PendingButton></form>
                  <form action={rejectFinding}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="finding_id" value={finding.id} /><PendingButton pendingLabel="Rejecting…" className="reject">Reject</PendingButton></form>
                </div>
              )}
              {finding.review_status === 'approved' && finding.decision === 'fix' && <div className="blueprint-ready">Approved + action justified · ready for Blueprint generation</div>}
              {finding.review_status === 'approved' && finding.decision !== 'fix' && <div className="blueprint-ready neutral">Approved diagnostic · no implementation blueprint is being manufactured for a {finding.decision.replaceAll('_', ' ')} decision.</div>}
            </article>
          )
        })}
      </div>

      {!findings?.length && <div className="empty-state"><h2>No WHY findings yet.</h2><p>Findings appear only after the benchmark has captured observations. Riseklix keeps measurement and explanation as separate stages.</p></div>}
    </div>
  )
}
