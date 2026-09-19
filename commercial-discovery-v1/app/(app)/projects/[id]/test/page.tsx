import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { runApprovedQuestions } from './actions'
import { PendingButton } from '@/components/pending-button'
import { ResearchJobWatcher } from '@/components/research-job-watcher'
import { BenchmarkCollectionResumer } from '@/components/benchmark-collection-resumer'
import { isUnaidedRetrievalEligible } from '@/lib/prompt-eligibility'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: benchmarks }, { data: expressions }, { data: memberships }, { data: observations }, { data: surfaces }, { data: intents }, { data: activeRun }] = await Promise.all([
    supabase.from('benchmarks').select('id,benchmark_type,status,version,started_at,completed_at,collection_config,created_at').eq('project_id', id).eq('benchmark_type', 'baseline').order('created_at', { ascending: false }),
    supabase.from('prompt_expressions').select('id,buyer_intent_id,language,mode,variant_no,prompt_text,status,is_frozen').eq('project_id', id).order('buyer_intent_id').order('language').order('mode').order('variant_no'),
    supabase.from('benchmark_prompts').select('benchmark_id,prompt_expression_id,buyer_intent_id').eq('project_id', id),
    supabase.from('observation_runs').select('id,benchmark_id,prompt_expression_id,provider,surface,model_label,repetition,language,run_status,retrieval_status,target_rank,captured_at,metadata,error_message').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('benchmark_surfaces').select('id,benchmark_id,provider,surface,model_label,enabled,status,expected_runs,captured_runs,error_runs,metadata,started_at,completed_at').eq('project_id', id).order('created_at'),
    supabase.from('buyer_intents').select('id,title,intent_key,status').eq('project_id', id),
    supabase.from('research_jobs').select('id,status,stage,progress,created_at').eq('project_id', id).eq('job_type', 'observation_collection').eq('stage', 'multi_surface_observation').eq('status', 'running').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const baseline = benchmarks?.[0]

  const intentById = new Map((intents ?? []).map((intent) => [intent.id, intent]))
  const approved = (expressions ?? []).filter((expression) => expression.status === 'approved')
  const invalidApprovedUnaided = approved.filter((expression) => expression.mode === 'unaided' && !isUnaidedRetrievalEligible(expression.prompt_text))
  const baselineApproved = approved.filter((expression) => expression.mode !== 'unaided' || isUnaidedRetrievalEligible(expression.prompt_text))

  const approvedByIntent = new Map<string, Set<string>>()
  for (const expression of baselineApproved) {
    const modes = approvedByIntent.get(expression.buyer_intent_id) ?? new Set<string>()
    modes.add(expression.mode)
    approvedByIntent.set(expression.buyer_intent_id, modes)
  }

  const eligibleIntentIds = new Set(
    Array.from(approvedByIntent.entries())
      .filter(([, modes]) => modes.has('unaided') && modes.has('aided'))
      .map(([intentId]) => intentId)
  )
  const eligibleQuestions = baselineApproved.filter((expression) => eligibleIntentIds.has(expression.buyer_intent_id))

  return (
    <div className="project-page test-page">
      <ResearchJobWatcher active={Boolean(activeRun)} />
      <section className="page-header compact">
        <div>
          <div className="eyebrow">RUN THE APPROVED QUESTIONS</div>
          <h1>Test</h1>
          <p>This is where approved buyer questions become a controlled baseline. Riseklix freezes the exact wording, then runs the same questions independently across the AI observation surfaces configured for this benchmark.</p>
        </div>
      </section>

      {error && <div className="form-alert error" role="alert">{error}</div>}
      {message && <div className="form-alert success" role="status" aria-live="polite">{message}</div>}
      {!baseline && invalidApprovedUnaided.length > 0 && (
        <div className="form-alert error" role="alert">
          {invalidApprovedUnaided.length} approved unaided question{invalidApprovedUnaided.length === 1 ? '' : 's'} ask for criteria or advice rather than named commercial options. They will not enter a new retrieval baseline; edit or regenerate them first if the affected Buyer Situation is otherwise incomplete.
        </div>
      )}

      {!baseline && (
        <>
          <section className="test-readiness">
            <div>
              <div className="eyebrow">READY TO TEST</div>
              <h2>{eligibleIntentIds.size ? `${eligibleQuestions.length} approved questions across ${eligibleIntentIds.size} Buyer Situation${eligibleIntentIds.size === 1 ? '' : 's'}` : 'Your approved set is not complete yet.'}</h2>
              <p>{eligibleIntentIds.size ? 'Each admitted Buyer Situation has at least one unaided buyer question and one aided brand check. Creating the baseline freezes these exact questions so every configured AI surface receives the same wording.' : 'A Buyer Situation needs both an approved buyer question and an approved brand check before it can enter the baseline.'}</p>
            </div>
            {eligibleIntentIds.size ? (
              <form action={runApprovedQuestions}>
                <input type="hidden" name="project_id" value={id} />
                <PendingButton pendingLabel="Starting all AI tests…">Run approved questions</PendingButton>
              </form>
            ) : (
              <Link href={`/projects/${id}/buyer-situations`} className="primary-link">Review buyer questions →</Link>
            )}
          </section>

          {!!approved.length && (
            <section className="approved-question-panel">
              <div className="approved-question-panel-head">
                <div>
                  <div className="eyebrow">APPROVED QUESTION SET</div>
                  <h2>These are the questions you approved.</h2>
                </div>
                <span>{eligibleQuestions.length} baseline-ready</span>
              </div>

              <div className="approved-question-groups">
                {Array.from(new Set(approved.map((expression) => expression.buyer_intent_id))).map((intentId) => {
                  const intent = intentById.get(intentId)
                  const questions = approved.filter((expression) => expression.buyer_intent_id === intentId)
                  const eligible = eligibleIntentIds.has(intentId)

                  return (
                    <article key={intentId} className={eligible ? 'eligible' : ''}>
                      <header>
                        <div>
                          <small>{intent?.intent_key ?? 'Buyer Situation'}</small>
                          <h3>{intent?.title ?? 'Approved Buyer Situation'}</h3>
                        </div>
                        <span>{eligible ? 'Ready' : 'Needs both modes'}</span>
                      </header>
                      <div className="approved-question-list">
                        {questions.map((question) => {
                          const retrievalEligible = question.mode !== 'unaided' || isUnaidedRetrievalEligible(question.prompt_text)
                          return (
                            <div key={question.id}>
                              <span>{question.mode === 'unaided' ? 'Buyer question' : 'Brand check'} · {question.language}{retrievalEligible ? '' : ' · not retrieval-eligible'}</span>
                              <p>{question.prompt_text}</p>
                            </div>
                          )
                        })}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {baseline && (() => {
        const config = record(baseline.collection_config)
        const benchmarkObservations = (observations ?? []).filter((run) => run.benchmark_id === baseline.id)
        const benchmarkSurfaces = (surfaces ?? []).filter((surface) => surface.benchmark_id === baseline.id && surface.enabled)
        const frozenMemberships = (memberships ?? []).filter((member) => member.benchmark_id === baseline.id)
        const frozenIds = new Set(frozenMemberships.map((member) => member.prompt_expression_id))
        const frozenQuestions = (expressions ?? []).filter((expression) => frozenIds.has(expression.id))
        const expectedTotal = benchmarkSurfaces.reduce((sum, surface) => sum + (surface.expected_runs || 0), 0)
        const capturedTotal = benchmarkSurfaces.reduce((sum, surface) => sum + (surface.captured_runs || 0), 0)
        const completedSurfaces = benchmarkSurfaces.filter((surface) => surface.status === 'complete').length
        const usableSurfaces = benchmarkSurfaces.filter((surface) => {
          const expectedRuns = Number(surface.expected_runs || 0)
          const capturedRuns = Number(surface.captured_runs || 0)
          return capturedRuns >= Math.max(1, Math.ceil(expectedRuns * 0.5))
        })
        const excludedSurfaces = benchmarkSurfaces.filter((surface) => !usableSurfaces.some((usable) => usable.provider === surface.provider))
        const progress = baseline.status === 'complete'
          ? 100
          : expectedTotal
            ? Math.min(Math.round((capturedTotal / expectedTotal) * 100), 100)
            : 0

        return (
          <>
            <BenchmarkCollectionResumer
              projectId={id}
              benchmarkId={baseline.id}
              active={['draft', 'running'].includes(baseline.status)}
            />
            <section className="test-baseline-head">
              <div>
                <div className="eyebrow">BASELINE v{baseline.version} · {baseline.status}</div>
                <h2>Your approved questions are frozen.</h2>
                <p>{frozenQuestions.length} exact questions · {benchmarkSurfaces.length} AI surfaces · {typeof config.repetitions_per_expression === 'number' ? config.repetitions_per_expression : 3} repetitions per question. Riseklix runs the same question set across every configured surface automatically.</p>
                {activeRun && <div className="job-line"><span>running</span><span>all AI surfaces</span><span>{activeRun.progress}%</span></div>}
              </div>
              <div className="test-master-actions">
                <Link href={`/projects/${id}/buyer-situations`} className="quiet-button">View frozen questions</Link>
                {baseline.status !== 'complete' && (
                  <span className="quiet-button" aria-live="polite">{activeRun ? 'Tests running automatically' : 'Collection resumes automatically'}</span>
                )}
              </div>
            </section>

            <section className="benchmark-progress test-progress">
              <div>
                <div className="eyebrow">TOTAL COLLECTION</div>
                <strong>{capturedTotal}/{expectedTotal || '—'} observations captured</strong>
                <span>{baseline.status === 'complete'
                  ? `${usableSurfaces.length} usable AI system${usableSurfaces.length === 1 ? '' : 's'} · ${excludedSurfaces.length} excluded`
                  : `${completedSurfaces}/${benchmarkSurfaces.length} AI systems complete`}</span>
              </div>
              <div className="benchmark-progress-track" aria-label={progress + '% complete'}><i style={{ width: progress + '%' }} /></div>
            </section>

            <div className="surface-list">
              {benchmarkSurfaces.map((surfaceConfig) => {
                const surfaceObservations = benchmarkObservations.filter((run) => run.provider === surfaceConfig.provider && run.surface === surfaceConfig.surface)
                const surfaceCaptured = surfaceObservations.filter((run) => run.run_status === 'captured')
                const surfaceUnaided = surfaceCaptured.filter((run) => record(run.metadata).prompt_mode === 'unaided')
                const surfaceRetrieved = surfaceUnaided.filter((run) => run.retrieval_status === 'retrieved')
                const meta = record(surfaceConfig.metadata)
                const label = surfaceConfig.provider === 'google' ? 'Gemini' : surfaceConfig.provider === 'anthropic' ? 'Claude' : surfaceConfig.provider === 'perplexity' ? 'Perplexity' : 'OpenAI'

                return (
                  <section className="observation-surface" key={surfaceConfig.id}>
                    <div className="observation-surface-head">
                      <div>
                        <div className="eyebrow">{label.toUpperCase()} · {surfaceConfig.status}</div>
                        <h3>{typeof meta.display_name === 'string' ? meta.display_name : `${surfaceConfig.provider} · ${surfaceConfig.surface}`}</h3>
                        <p>{typeof meta.methodology_note === 'string' ? meta.methodology_note : 'Results remain isolated by provider and surface.'}</p>
                        {surfaceConfig.status === 'failed' && typeof meta.last_error === 'string' && (
                          <div className="inline-job-error" role="alert">{meta.last_error}</div>
                        )}
                      </div>
                    </div>

                    <div className="observation-facts">
                      <div><small>Captured</small><strong>{surfaceConfig.captured_runs}/{surfaceConfig.expected_runs || '—'}</strong></div>
                      <div><small>Unaided retrieved</small><strong>{surfaceUnaided.length ? `${surfaceRetrieved.length}/${surfaceUnaided.length}` : '—'}</strong></div>
                      <div><small>Capture errors</small><strong>{surfaceConfig.error_runs}</strong></div>
                      <div><small>Model</small><strong>{surfaceConfig.model_label || 'Resolved on first run'}</strong></div>
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

            {baseline.status === 'complete' && (
              <section className="next-step-panel">
                <div className="eyebrow">BASELINE COMPLETE</div>
                <h2>Now interpret what happened.</h2>
                <p>The observation evidence is ready for the WHY layer. Results stay separated by AI surface, and aided controls never count toward unaided retrieval.</p>
                <Link href={`/projects/${id}/why`} className="primary-link">Open WHY analysis →</Link>
              </section>
            )}
          </>
        )
      })()}
    </div>
  )
}
