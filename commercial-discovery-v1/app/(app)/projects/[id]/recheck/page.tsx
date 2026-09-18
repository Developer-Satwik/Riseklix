import { createClient } from '@/lib/supabase/server'
import { createBaselinePanel, createPostChangeRecheck, runOpenAIObservationBatch } from './actions'
import { PendingButton } from '@/components/pending-button'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default async function RecheckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: benchmarks }, { data: expressions }, { data: memberships }, { data: observations }, { data: surfaces }, { data: verifiedTasks }] = await Promise.all([
    supabase.from('benchmarks').select('id,benchmark_type,status,version,started_at,completed_at,parent_benchmark_id,collection_config,created_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('prompt_expressions').select('id,buyer_intent_id,language,mode,status,is_frozen').eq('project_id', id),
    supabase.from('benchmark_prompts').select('benchmark_id,prompt_expression_id,buyer_intent_id').eq('project_id', id),
    supabase.from('observation_runs').select('id,benchmark_id,prompt_expression_id,provider,surface,model_label,repetition,language,run_status,retrieval_status,target_rank,captured_at,metadata,error_message').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('benchmark_surfaces').select('id,benchmark_id,provider,surface,model_label,enabled,status,expected_runs,captured_runs,error_runs,metadata,started_at,completed_at').eq('project_id', id).order('created_at'),
    supabase.from('implementation_tasks').select('id,blueprint_id,route,status,verified_at').eq('project_id', id).eq('status', 'verified').order('verified_at', { ascending: false }),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const baseline = benchmarks?.find((benchmark) => benchmark.benchmark_type === 'baseline')
  const activeRecheck = benchmarks?.find((benchmark) => benchmark.benchmark_type === 'recheck' && ['draft', 'running'].includes(benchmark.status))
  const verifiedTaskCount = verifiedTasks?.length ?? 0

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
          <p>A verified implementation and a changed AI result are separate facts. The baseline freezes approved question expressions; each observation surface completes independently, and the benchmark completes only when every enabled surface is done.</p>
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
            <PendingButton pendingLabel="Freezing baseline…" disabled={!eligibleIntentCount}>Create frozen baseline</PendingButton>
          </form>
        </section>
      )}

      {baseline?.status === 'complete' && verifiedTaskCount > 0 && !activeRecheck && (
        <section className="post-change-cta">
          <div>
            <div className="eyebrow">VERIFIED WORK → COMPARABLE RECHECK</div>
            <h2>{verifiedTaskCount} verified implementation{verifiedTaskCount === 1 ? ' is' : 's are'} ready to measure.</h2>
            <p>Riseklix will reuse the frozen prompt panel and the same declared observation surfaces. The new run records what had been verified before measurement without claiming those changes caused any subsequent model behavior.</p>
          </div>
          <form action={createPostChangeRecheck}>
            <input type="hidden" name="project_id" value={id} />
            <input type="hidden" name="baseline_id" value={baseline.id} />
            <PendingButton pendingLabel="Creating comparable recheck…">Create post-change recheck</PendingButton>
          </form>
        </section>
      )}

      {activeRecheck && (
        <section className="post-change-cta active">
          <div>
            <div className="eyebrow">POST-CHANGE RECHECK ACTIVE</div>
            <h2>Keep the comparison panel frozen until collection finishes.</h2>
            <p>This recheck is tied back to the baseline and the implementation snapshot that existed before collection started.</p>
          </div>
          <span>{activeRecheck.status}</span>
        </section>
      )}

      {!!benchmarks?.length && (
        <div className="benchmark-list">
          {benchmarks.map((benchmark) => {
            const config = record(benchmark.collection_config)
            const promptCount = (memberships ?? []).filter((member) => member.benchmark_id === benchmark.id).length
            const benchmarkObservations = (observations ?? []).filter((run) => run.benchmark_id === benchmark.id)
            const captured = benchmarkObservations.filter((run) => run.run_status === 'captured')
            const repetitions = typeof config.repetitions_per_expression === 'number' ? config.repetitions_per_expression : 3
            const benchmarkSurfaces = (surfaces ?? []).filter((surface) => surface.benchmark_id === benchmark.id && surface.enabled)
            const expectedTotal = benchmarkSurfaces.reduce((sum, surface) => sum + (surface.expected_runs || 0), 0)
            const capturedTotal = benchmarkSurfaces.reduce((sum, surface) => sum + (surface.captured_runs || 0), 0)
            const completedSurfaces = benchmarkSurfaces.filter((surface) => surface.status === 'complete').length
            const progress = expectedTotal ? Math.min(Math.round((capturedTotal / expectedTotal) * 100), 100) : 0

            return (
              <article key={benchmark.id}>
                <div className="benchmark-top"><span>{benchmark.benchmark_type} v{benchmark.version}</span><strong>{benchmark.status}</strong></div>
                <h2>{benchmark.benchmark_type === 'baseline' ? 'Frozen comparison point' : 'Comparable recheck'}</h2>
                <div className="benchmark-facts">
                  <div><small>Question expressions</small><strong>{promptCount}</strong></div>
                  <div><small>Buyer intents</small><strong>{typeof config.intent_count === 'number' ? config.intent_count : '—'}</strong></div>
                  <div><small>Repetitions</small><strong>{repetitions}</strong></div>
                  <div><small>Enabled surfaces</small><strong>{benchmarkSurfaces.length}</strong></div>
                </div>

                <div className="benchmark-progress">
                  <div>
                    <div className="eyebrow">COLLECTION PROGRESS</div>
                    <strong>{capturedTotal}/{expectedTotal || '—'} observations captured</strong>
                    <span>{completedSurfaces}/{benchmarkSurfaces.length || 0} declared surfaces complete</span>
                  </div>
                  <div className="benchmark-progress-track" aria-label={progress + '% complete'}><i style={{ width: progress + '%' }} /></div>
                </div>

                <div className="surface-list">
                  {benchmarkSurfaces.map((surfaceConfig) => {
                    const surfaceObservations = benchmarkObservations.filter((run) => run.provider === surfaceConfig.provider && run.surface === surfaceConfig.surface)
                    const surfaceCaptured = surfaceObservations.filter((run) => run.run_status === 'captured')
                    const surfaceUnaided = surfaceCaptured.filter((run) => record(run.metadata).prompt_mode === 'unaided')
                    const surfaceRetrieved = surfaceUnaided.filter((run) => run.retrieval_status === 'retrieved')
                    const meta = record(surfaceConfig.metadata)
                    const isOpenAI = surfaceConfig.provider === 'openai' && surfaceConfig.surface === 'openai_responses_web_search'

                    return (
                      <section className="observation-surface" key={surfaceConfig.id}>
                        <div className="observation-surface-head">
                          <div>
                            <div className="eyebrow">OBSERVATION SURFACE · {surfaceConfig.status}</div>
                            <h3>{typeof meta.display_name === 'string' ? meta.display_name : `${surfaceConfig.provider} · ${surfaceConfig.surface}`}</h3>
                            <p>{typeof meta.methodology_note === 'string' ? meta.methodology_note : 'This observation surface is declared separately so results are not silently mixed across products or APIs.'}</p>
                          </div>
                          {isOpenAI && surfaceConfig.status !== 'complete' && (
                            <form action={runOpenAIObservationBatch}>
                              <input type="hidden" name="project_id" value={id} />
                              <input type="hidden" name="benchmark_id" value={benchmark.id} />
                              <PendingButton pendingLabel="Collecting observations…">{surfaceConfig.captured_runs ? 'Run next 4 observations' : 'Start OpenAI baseline'}</PendingButton>
                            </form>
                          )}
                        </div>
                        <div className="observation-facts">
                          <div><small>Captured</small><strong>{surfaceConfig.captured_runs}/{surfaceConfig.expected_runs || '—'}</strong></div>
                          <div><small>Unaided retrieved</small><strong>{surfaceUnaided.length ? `${surfaceRetrieved.length}/${surfaceUnaided.length}` : '—'}</strong></div>
                          <div><small>Capture errors</small><strong>{surfaceConfig.error_runs}</strong></div>
                          <div><small>Model label</small><strong>{surfaceConfig.model_label || 'Resolved on first run'}</strong></div>
                        </div>
                        {!!surfaceCaptured.length && (
                          <div className="recent-observations">
                            {surfaceCaptured.slice(0, 6).map((run) => {
                              const runMeta = record(run.metadata)
                              return (
                                <div key={run.id}>
                                  <span>{String(runMeta.prompt_mode ?? 'unknown')} · {run.language} · rep {run.repetition}</span>
                                  <strong>{run.retrieval_status === 'retrieved' ? `retrieved${run.target_rank ? ` · rank ${run.target_rank}` : ''}` : 'NR'}</strong>
                                  <small>{run.model_label || run.surface}</small>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>

                <p>{benchmark.completed_at ? `All enabled surfaces completed ${new Date(benchmark.completed_at).toLocaleString()}` : benchmark.started_at ? `Collection started ${new Date(benchmark.started_at).toLocaleString()}` : 'Panel is frozen and ready for its configured observation surfaces.'}</p>
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
          <p>NR is assigned only after a captured answer does not place the target in the recommended or shortlisted provider set. Failed captures remain errors; unrun repetitions remain pending. Aided controls never count toward unaided discovery visibility. Results from different provider surfaces remain separately labeled.</p>
        </section>
      )}
    </div>
  )
}
