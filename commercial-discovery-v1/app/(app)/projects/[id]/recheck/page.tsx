import { createClient } from '@/lib/supabase/server'
import { createBaselinePanel, runOpenAIObservationBatch } from './actions'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default async function RecheckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: benchmarks }, { data: expressions }, { data: memberships }, { data: observations }] = await Promise.all([
    supabase.from('benchmarks').select('id,benchmark_type,status,version,started_at,completed_at,parent_benchmark_id,collection_config,created_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('prompt_expressions').select('id,buyer_intent_id,language,mode,status,is_frozen').eq('project_id', id),
    supabase.from('benchmark_prompts').select('benchmark_id,prompt_expression_id,buyer_intent_id').eq('project_id', id),
    supabase.from('observation_runs').select('id,benchmark_id,prompt_expression_id,provider,surface,model_label,repetition,language,run_status,retrieval_status,target_rank,captured_at,metadata,error_message').eq('project_id', id).order('created_at', { ascending: false }),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const baseline = benchmarks?.find((benchmark) => benchmark.benchmark_type === 'baseline')

  const approvedByIntent = new Map<string, Set<string>>()
  for (const expression of expressions ?? []) {
    if (expression.status !== 'approved') continue
    const modes = approvedByIntent.get(expression.buyer_intent_id) ?? new Set<string>()
    modes.add(expression.mode)
    approvedByIntent.set(expression.buyer_intent_id, modes)
  }
  const eligibleIntentCount = Array.from(approvedByIntent.values()).filter((modes) => modes.has('unaided') && modes.has('aided')).length
  const approvedExpressionCount = (expressions ?? []).filter((expression) => expression.status === 'approved').length

  return (
    <div className="project-page">
      <section className="page-header compact">
        <div>
          <div className="eyebrow">DID ANYTHING CHANGE?</div>
          <h1>Recheck</h1>
          <p>A verified implementation and a changed AI result are separate facts. The baseline freezes approved question expressions; future rechecks reuse the comparable panel rather than silently changing the test.</p>
        </div>
      </section>

      {error && <div className="form-alert error">{error}</div>}
      {message && <div className="form-alert success">{message}</div>}

      {!baseline && (
        <section className="baseline-builder">
          <div>
            <div className="eyebrow">FREEZE THE FIRST PANEL</div>
            <h2>{eligibleIntentCount ? 'Your approved questions can become the baseline.' : 'The benchmark is not ready yet.'}</h2>
            <p>{eligibleIntentCount ? `${approvedExpressionCount} approved expressions across ${eligibleIntentCount} eligible Buyer Intent${eligibleIntentCount === 1 ? '' : 's'}. Only intents containing both unaided and aided controls are admitted to the frozen panel.` : 'Approve at least one unaided question and one aided control under the same Buyer Intent. Competitor discovery and prompt review happen on Buyer Situations.'}</p>
          </div>
          <form action={createBaselinePanel}>
            <input type="hidden" name="project_id" value={id} />
            <button type="submit" disabled={!eligibleIntentCount}>Create frozen baseline</button>
          </form>
        </section>
      )}

      {!!benchmarks?.length && (
        <div className="benchmark-list">
          {benchmarks.map((benchmark) => {
            const config = record(benchmark.collection_config)
            const promptCount = (memberships ?? []).filter((member) => member.benchmark_id === benchmark.id).length
            const benchmarkObservations = (observations ?? []).filter((run) => run.benchmark_id === benchmark.id)
            const captured = benchmarkObservations.filter((run) => run.run_status === 'captured')
            const errors = benchmarkObservations.filter((run) => run.run_status === 'error')
            const unaided = captured.filter((run) => record(run.metadata).prompt_mode === 'unaided')
            const unaidedRetrieved = unaided.filter((run) => run.retrieval_status === 'retrieved')
            const repetitions = typeof config.repetitions_per_expression === 'number' ? config.repetitions_per_expression : 3
            const expectedOpenAIRuns = promptCount * repetitions
            const openAICaptured = captured.filter((run) => run.provider === 'openai' && run.surface === 'openai_responses_web_search').length
            const observationComplete = expectedOpenAIRuns > 0 && openAICaptured >= expectedOpenAIRuns

            return (
              <article key={benchmark.id}>
                <div className="benchmark-top"><span>{benchmark.benchmark_type} v{benchmark.version}</span><strong>{benchmark.status}</strong></div>
                <h2>{benchmark.benchmark_type === 'baseline' ? 'Frozen comparison point' : 'Comparable recheck'}</h2>
                <div className="benchmark-facts">
                  <div><small>Question expressions</small><strong>{promptCount}</strong></div>
                  <div><small>Buyer intents</small><strong>{typeof config.intent_count === 'number' ? config.intent_count : '—'}</strong></div>
                  <div><small>Repetitions</small><strong>{repetitions}</strong></div>
                  <div><small>Captured runs</small><strong>{captured.length}</strong></div>
                </div>

                <section className="observation-surface">
                  <div className="observation-surface-head">
                    <div>
                      <div className="eyebrow">OBSERVATION SURFACE · DECLARED</div>
                      <h3>OpenAI Responses API · forced web search</h3>
                      <p>This is stored as an API observation surface, not labeled as the ChatGPT consumer application. Every run is a fresh session and preserves model label, citations, repetition and capture state.</p>
                    </div>
                    {!observationComplete && (
                      <form action={runOpenAIObservationBatch}>
                        <input type="hidden" name="project_id" value={id} />
                        <input type="hidden" name="benchmark_id" value={benchmark.id} />
                        <button type="submit">{openAICaptured ? 'Run next 4 observations' : 'Start OpenAI baseline'}</button>
                      </form>
                    )}
                  </div>
                  <div className="observation-facts">
                    <div><small>OpenAI captures</small><strong>{openAICaptured}/{expectedOpenAIRuns || '—'}</strong></div>
                    <div><small>Unaided retrieved</small><strong>{unaided.length ? `${unaidedRetrieved.length}/${unaided.length}` : '—'}</strong></div>
                    <div><small>Capture errors</small><strong>{errors.length}</strong></div>
                    <div><small>State</small><strong>{observationComplete ? 'surface complete' : openAICaptured ? 'collecting' : 'not started'}</strong></div>
                  </div>
                  {!!captured.length && (
                    <div className="recent-observations">
                      {captured.slice(0, 6).map((run) => {
                        const meta = record(run.metadata)
                        return (
                          <div key={run.id}>
                            <span>{String(meta.prompt_mode ?? 'unknown')} · {run.language} · rep {run.repetition}</span>
                            <strong>{run.retrieval_status === 'retrieved' ? `retrieved${run.target_rank ? ` · rank ${run.target_rank}` : ''}` : 'NR'}</strong>
                            <small>{run.model_label || run.surface}</small>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>

                <p>{benchmark.completed_at ? `Completed ${new Date(benchmark.completed_at).toLocaleString()}` : benchmark.started_at ? `Started ${new Date(benchmark.started_at).toLocaleString()}` : 'Panel is frozen and ready for declared observation surfaces.'}</p>
              </article>
            )
          })}
        </div>
      )}

      {!benchmarks?.length && !eligibleIntentCount && <div className="empty-state"><h2>No benchmark yet.</h2><p>The first baseline becomes available after reviewed Buyer Intents have approved unaided and aided question expressions.</p></div>}

      {baseline && (
        <section className="next-step-panel">
          <div className="eyebrow">METHOD NOTE</div>
          <h2>NR, capture failure and “not run yet” stay separate.</h2>
          <p>NR is assigned only after a captured answer does not place the target in the recommended or shortlisted provider set. Failed captures remain errors; unrun repetitions remain pending. Aided controls never count toward unaided discovery visibility.</p>
        </section>
      )}
    </div>
  )
}
