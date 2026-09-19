import { createClient } from '@/lib/supabase/server'
import { addIntentCandidate, approveIntent, rejectIntent } from './actions'
import { generateBuyerIntents } from './generate-actions'
import { discoverCompetitors } from './competitor-actions'
import { approvePromptExpression, generatePromptExpressions, rejectPromptExpression } from './prompt-actions'
import { PendingButton } from '@/components/pending-button'
import { ResearchJobWatcher } from '@/components/research-job-watcher'
import { runApprovedQuestions } from '../test/actions'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function evidenceItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(record).filter((item) => typeof item.url === 'string')
}

function constraintItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return { text: item, importance: null as string | null }
    const row = record(item)
    return {
      text: typeof row.text === 'string' ? row.text : JSON.stringify(item),
      importance: typeof row.importance === 'string' ? row.importance : null,
    }
  }).filter((item) => item.text.trim().length > 0)
}

function textItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' ? item : String(record(item).text ?? '')).filter(Boolean)
}

export default async function BuyerSituationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: intents }, { data: profile }, { data: latestJob }, { data: competitorJobs }, { data: promptJobs }, { data: competitors }, { data: prompts }] = await Promise.all([
    supabase.from('buyer_intents').select('id,intent_key,title,buyer,job_to_be_done,provenance,provenance_reason,priority,status,review_source,commercial_model,geography,constraints,required_capabilities,purchase_stage,language_policy,source_refs').eq('project_id', id).order('created_at'),
    supabase.from('company_profile_versions').select('status,company_name').eq('project_id', id).eq('is_current', true).single(),
    supabase.from('research_jobs').select('id,status,stage,progress,output,error,created_at').eq('project_id', id).eq('job_type', 'intent_generation').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('research_jobs').select('id,status,stage,progress,error,input,created_at').eq('project_id', id).eq('job_type', 'competitor_discovery').order('created_at', { ascending: false }).limit(50),
    supabase.from('research_jobs').select('id,status,stage,progress,error,input,created_at').eq('project_id', id).eq('job_type', 'prompt_generation').order('created_at', { ascending: false }).limit(50),
    supabase.from('competitor_candidates').select('id,buyer_intent_id,company_name,domain,relationship,discovery_layer,status,matched_constraints,relaxed_constraints,evidence,evidence_strength,rationale,is_current').eq('project_id', id).eq('is_current', true).order('discovery_layer').order('company_name'),
    supabase.from('prompt_expressions').select('id,buyer_intent_id,language,mode,variant_no,prompt_text,status,review_source,is_frozen,version').eq('project_id', id).order('language').order('mode').order('variant_no'),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const unlocked = profile?.status === 'approved'
  const approvedCount = intents?.filter((intent) => intent.status === 'approved').length ?? 0
  const candidateCount = intents?.filter((intent) => intent.status === 'candidate').length ?? 0
  const latestJobError = latestJob?.error && typeof latestJob.error === 'object' && !Array.isArray(latestJob.error) && typeof (latestJob.error as Record<string, unknown>).message === 'string'
    ? String((latestJob.error as Record<string, unknown>).message)
    : null

  const approvedQuestionModes = new Map<string, Set<string>>()
  for (const prompt of prompts ?? []) {
    if (prompt.status !== 'approved') continue
    const modes = approvedQuestionModes.get(prompt.buyer_intent_id) ?? new Set<string>()
    modes.add(prompt.mode)
    approvedQuestionModes.set(prompt.buyer_intent_id, modes)
  }
  const testReadyIntentCount = Array.from(approvedQuestionModes.values()).filter((modes) => modes.has('unaided') && modes.has('aided')).length
  const approvedQuestionCount = (prompts ?? []).filter((prompt) => prompt.status === 'approved').length

  return (
    <div className="project-page">
      <ResearchJobWatcher active={latestJob?.status === 'running' || (competitorJobs ?? []).some((job) => job.status === 'running') || (promptJobs ?? []).some((job) => job.status === 'running')} />
      <section className="page-header compact">
        <div>
          <div className="eyebrow">WHERE SHOULD WE BE CONSIDERED?</div>
          <h1>Buyer Situations</h1>
          <p>Riseklix first defines the buying situation in plain business terms. Once you approve it, Riseklix researches the competitor set and generates the exact natural-language questions that will be asked across AI models.</p>
        </div>
      </section>

      {error && <div className="form-alert error" role="alert">{error}</div>}
      {message && <div className="form-alert success" role="status" aria-live="polite">{message}</div>}

      <section className={`intent-engine-state ${unlocked ? 'unlocked' : ''}`}>
        <div>
          <div className="eyebrow">BUYER INTENT ENGINE</div>
          <h2>{unlocked ? 'Company context approved. Intent generation is unlocked.' : 'Approve Company Intelligence first.'}</h2>
          <p>{unlocked ? `${approvedCount} approved · ${candidateCount} awaiting review. AI-suggested situations remain candidates until you approve them.` : 'Riseklix will not generate confident-looking prompts from an unapproved understanding of the business.'}</p>
          {latestJob && <div className="job-line"><span>{latestJob.status}</span><span>{latestJob.stage ?? 'queued'}</span><span>{latestJob.progress}%</span></div>}
          {latestJob?.status === 'failed' && latestJobError && <div className="inline-job-error" role="alert">{latestJobError}</div>}
        </div>
        {unlocked ? (
          <form action={generateBuyerIntents} className="intent-generate-form">
            <input type="hidden" name="project_id" value={id} />
            <PendingButton pendingLabel="Generating situations…">{candidateCount ? 'Reuse / generate candidates' : 'Generate Buyer Situations'}</PendingButton>
          </form>
        ) : <span>LOCKED</span>}
      </section>

      {testReadyIntentCount > 0 && (
        <section className="questions-ready-cta">
          <div>
            <div className="eyebrow">APPROVED QUESTIONS READY</div>
            <h2>{approvedQuestionCount} approved question{approvedQuestionCount === 1 ? '' : 's'} can now be tested.</h2>
            <p>{testReadyIntentCount} Buyer Situation{testReadyIntentCount === 1 ? '' : 's'} contain both a buyer question and brand check. Your approved questions stay here for review; running them happens in the Test stage.</p>
          </div>
          <form action={runApprovedQuestions}>
            <input type="hidden" name="project_id" value={id} />
            <PendingButton pendingLabel="Starting all AI tests…" className="spotlight-cta">Run approved questions <span aria-hidden="true">→</span></PendingButton>
          </form>
        </section>
      )}

      {!!intents?.length && (
        <section className="intent-summary-strip" aria-label="Buyer Situation review status">
          <div><span>Awaiting review</span><strong>{candidateCount}</strong></div>
          <div><span>Approved</span><strong>{approvedCount}</strong></div>
          <div><span>Competitor sets ready</span><strong>{new Set((competitors ?? []).map((item) => item.buyer_intent_id)).size}</strong></div>
          <div><span>Buyer question sets</span><strong>{new Set((prompts ?? []).map((item) => item.buyer_intent_id)).size}</strong></div>
        </section>
      )}

      {!!intents?.length && (
        <div className="intent-list review-intents">
          {intents.map((intent) => {
            const intentCompetitors = (competitors ?? []).filter((competitor) => competitor.buyer_intent_id === intent.id)
            const intentPrompts = (prompts ?? []).filter((prompt) => prompt.buyer_intent_id === intent.id)
            const approvedPrompts = intentPrompts.filter((prompt) => prompt.status === 'approved').length
            const intentCompetitorJob = (competitorJobs ?? []).find((job) => {
              const input = record(job.input)
              return input.intent_id === intent.id
            })
            const competitorJobError = intentCompetitorJob?.error && typeof intentCompetitorJob.error === 'object' && !Array.isArray(intentCompetitorJob.error)
              ? String((intentCompetitorJob.error as Record<string, unknown>).message || '')
              : ''
            const intentPromptJob = (promptJobs ?? []).find((job) => {
              const input = record(job.input)
              return input.intent_id === intent.id
            })
            const promptJobError = intentPromptJob?.error && typeof intentPromptJob.error === 'object' && !Array.isArray(intentPromptJob.error)
              ? String((intentPromptJob.error as Record<string, unknown>).message || '')
              : ''
            const constraints = constraintItems(intent.constraints)
            const capabilities = textItems(intent.required_capabilities)

            return (
              <article key={intent.id} className={intent.status === 'rejected' ? 'intent-rejected' : ''}>
                <div className="intent-meta"><span>{intent.intent_key}</span><span>{intent.provenance}</span><span>{intent.priority}</span><span>{intent.status}</span>{intent.review_source && <span>{intent.review_source === 'autopilot' ? 'AI accepted' : 'human reviewed'}</span>}</div>
                <div className="intent-not-prompt">COMMERCIAL SITUATION · NOT SENT TO AI</div>
                <h2>{intent.title}</h2>
                <p className="intent-job"><span>What the buyer is trying to do</span>{intent.job_to_be_done}</p>
                <div className="intent-facts">
                  <div><small>Buyer</small><strong>{intent.buyer || 'Not specified'}</strong></div>
                  <div><small>Commercial model</small><strong>{intent.commercial_model || 'Not specified'}</strong></div>
                  <div><small>Geography</small><strong>{intent.geography && typeof intent.geography === 'object' && !Array.isArray(intent.geography) && 'primary' in intent.geography ? String(intent.geography.primary) : 'Not specified'}</strong></div>
                  <div><small>Purchase stage</small><strong>{intent.purchase_stage || 'Not specified'}</strong></div>
                </div>

                <details className="intent-details">
                  <summary>Research logic and decision constraints</summary>
                  <div className="intent-provenance-note">
                    <small>Why Riseklix included this</small>
                    <p>{intent.provenance_reason || 'No provenance rationale recorded.'}</p>
                  </div>
                  <div className="intent-detail-columns">
                    <div>
                      <small>Decision constraints</small>
                      <ul className="plain-research-list">
                        {constraints.map((item, index) => <li key={index}><span>{item.text}</span>{item.importance && <em>{item.importance}</em>}</li>)}
                        {!constraints.length && <li><span>No explicit constraints recorded.</span></li>}
                      </ul>
                    </div>
                    <div>
                      <small>Capabilities a provider needs</small>
                      <ul className="plain-research-list">
                        {capabilities.map((item, index) => <li key={index}><span>{item}</span></li>)}
                        {!capabilities.length && <li><span>No explicit capabilities recorded.</span></li>}
                      </ul>
                    </div>
                  </div>
                </details>

                {intent.status === 'candidate' && (
                  <div className="intent-actions">
                    <form action={approveIntent}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="intent_id" value={intent.id} /><PendingButton pendingLabel="Approving…">Approve</PendingButton></form>
                    <form action={rejectIntent}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="intent_id" value={intent.id} /><PendingButton pendingLabel="Rejecting…" className="reject">Reject</PendingButton></form>
                  </div>
                )}

                {intent.status === 'approved' && (
                  <div className="intent-workbench">
                    <div className="intent-workbench-summary">
                      <div>
                        <span>Competitive set</span><strong>{intentCompetitors.length ? intentCompetitors.length + ' candidates' : 'Not generated'}</strong>
                      </div>
                      <div>
                        <span>Exact buyer questions</span><strong>{intentPrompts.length ? approvedPrompts + '/' + intentPrompts.length + ' approved' : 'Not generated'}</strong>
                      </div>
                    </div>

                    <details className="workflow-disclosure">
                      <summary>
                        <span><strong>Competitor universe</strong><small>Who can realistically compete for this buying decision?</small></span>
                        <span>{intentCompetitors.length ? intentCompetitors.length : '—'}</span>
                      </summary>
                      <section className="competitor-section">
                      <div className="competitor-heading">
                        <div>
                          <div className="eyebrow">INTENT-SPECIFIC COMPETITOR UNIVERSE</div>
                          <h3>{intentCompetitors.length ? `${intentCompetitors.length} evidence-backed candidates` : 'No competitor set generated yet.'}</h3>
                          <p>Hard constraints are never relaxed. L0 is direct fit; L1–L3 are controlled broadening; L4 is a substitute; L5 is a benchmark.</p>
                          {intentCompetitorJob?.status === 'running' && (
                            <div className="competitor-job-state" role="status" aria-live="polite">
                              <span>Researching</span>
                              <strong>{intentCompetitorJob.stage?.replaceAll('_', ' ') || 'competitor universe'}</strong>
                              <small>{intentCompetitorJob.progress}%</small>
                            </div>
                          )}
                          {intentCompetitorJob?.status === 'failed' && competitorJobError && (
                            <div className="inline-job-error" role="alert">{competitorJobError}</div>
                          )}
                        </div>
                        <form action={discoverCompetitors}>
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="intent_id" value={intent.id} />
                          <input type="hidden" name="regenerate" value={intentCompetitors.length ? 'true' : 'false'} />
                          <PendingButton pendingLabel="Researching competitors…">{intentCompetitors.length ? 'Refresh competitor set' : 'Discover competitors'}</PendingButton>
                        </form>
                      </div>

                      {!!intentCompetitors.length && (
                        <div className="competitor-list">
                          {intentCompetitors.map((competitor) => {
                            const evidence = evidenceItems(competitor.evidence)
                            return (
                              <div className="competitor-card" key={competitor.id}>
                                <div className="competitor-badges"><span>L{competitor.discovery_layer}</span><span>{competitor.relationship.replaceAll('_', ' ')}</span><span>{competitor.evidence_strength} evidence</span></div>
                                <h4>{competitor.company_name}</h4>
                                <small>{competitor.domain || 'Domain not captured'}</small>
                                <p>{competitor.rationale || 'No rationale captured.'}</p>
                                <div className="competitor-fit-grid">
                                  <div><small>Matched</small><pre>{JSON.stringify(competitor.matched_constraints ?? [], null, 2)}</pre></div>
                                  <div><small>Relaxed</small><pre>{JSON.stringify(competitor.relaxed_constraints ?? [], null, 2)}</pre></div>
                                </div>
                                {!!evidence.length && (
                                  <div className="competitor-evidence">
                                    <small>Evidence used</small>
                                    {evidence.map((item, index) => (
                                      <a key={`${String(item.url)}-${index}`} href={String(item.url)} target="_blank" rel="noreferrer">
                                        <strong>{typeof item.title === 'string' ? item.title : String(item.url)}</strong>
                                        <span>{typeof item.claim === 'string' ? item.claim : String(item.url)}</span>
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      </section>
                    </details>

                    <details className="workflow-disclosure">
                      <summary>
                        <span><strong>Exact buyer questions</strong><small>The actual sentences Riseklix will send to each enabled AI model.</small></span>
                        <span>{intentPrompts.length ? approvedPrompts + '/' + intentPrompts.length : '—'}</span>
                      </summary>
                      <section className="prompt-section">
                      <div className="prompt-heading">
                        <div>
                          <div className="eyebrow">EXACT AI QUESTIONS</div>
                          <h3>{intentPrompts.length ? `${approvedPrompts}/${intentPrompts.length} approved` : 'Generate the exact buyer wording after the competitor universe is known.'}</h3>
                          <p><strong>Buyer question</strong> asks for options without naming the client. <strong>Brand check</strong> asks about the same buying decision with the client named. Approved questions are frozen and reused across every enabled model surface so comparisons stay fair.</p>
                          <div className="question-surface-chips" aria-label="AI surfaces">
                            <span>OpenAI</span><span>Gemini</span><span>Claude</span><span>Perplexity</span>
                          </div>
                          {intentPromptJob?.status === 'running' && (
                            <div className="competitor-job-state" role="status" aria-live="polite">
                              <span>Generating</span>
                              <strong>{intentPromptJob.stage?.replaceAll('_', ' ') || 'buyer questions'}</strong>
                              <small>{intentPromptJob.progress}%</small>
                            </div>
                          )}
                          {intentPromptJob?.status === 'failed' && promptJobError && <div className="inline-job-error" role="alert">{promptJobError}</div>}
                        </div>
                        {!!intentCompetitors.length && !intentPrompts.length && (
                          <form action={generatePromptExpressions}>
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="intent_id" value={intent.id} />
                            <input type="hidden" name="regenerate" value="false" />
                            <PendingButton pendingLabel="Generating buyer questions…">Generate buyer questions</PendingButton>
                          </form>
                        )}
                      </div>

                      {!!intentPrompts.length && (
                        <div className="prompt-list">
                          {intentPrompts.map((prompt) => (
                            <div className={`prompt-card prompt-${prompt.status}`} key={prompt.id}>
                              <div className="prompt-card-meta"><span>{prompt.language}</span><span>{prompt.mode === 'unaided' ? 'buyer question' : 'brand check'}</span><span>v{prompt.version}.{prompt.variant_no}</span><span>{prompt.status}</span>{prompt.review_source && <span>{prompt.review_source === 'autopilot' ? 'AI accepted' : 'human reviewed'}</span>}{prompt.is_frozen && <span>frozen</span>}</div>
                              <small className="prompt-human-label">{prompt.mode === 'unaided' ? 'WHAT A BUYER COULD ACTUALLY ASK' : 'SAME DECISION · COMPANY NAMED'}</small>
                              <p>{prompt.prompt_text}</p>
                              <div className="prompt-surface-note">Runs independently across every enabled AI surface.</div>
                              {prompt.status === 'candidate' && !prompt.is_frozen && (
                                <div className="prompt-actions">
                                  <form action={approvePromptExpression}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="intent_id" value={intent.id} /><input type="hidden" name="prompt_id" value={prompt.id} /><PendingButton pendingLabel="Approving…">Approve</PendingButton></form>
                                  <form action={rejectPromptExpression}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="intent_id" value={intent.id} /><input type="hidden" name="prompt_id" value={prompt.id} /><PendingButton pendingLabel="Rejecting…" className="reject">Reject</PendingButton></form>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      </section>
                    </details>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {!intents?.length && <div className="empty-state"><h2>No buyer situations yet.</h2><p>{unlocked ? 'Generate evidence-grounded candidates above. Nothing becomes part of the benchmark until you approve it.' : 'They will be generated only after the company profile is reviewed and approved.'}</p></div>}

      {unlocked && (
        <details className="manual-intent-panel">
          <summary>Internal QA · add a structured Buyer Intent manually</summary>
          <p>This is a development fallback, not the final customer workflow. It validates the intent schema and downstream competitor workflow independently of a reasoning provider.</p>
          <form action={addIntentCandidate} className="manual-intent-form">
            <input type="hidden" name="project_id" value={id} />
            <label>Situation title<input name="title" placeholder="Multi-city project rental" required /></label>
            <label>Buyer<input name="buyer" placeholder="National EPC contractor" required /></label>
            <label className="full">Job to be done<textarea name="job_to_be_done" placeholder="Needs temporary access equipment across several active project locations with one accountable supplier." required /></label>
            <label>Commercial model<input name="commercial_model" placeholder="Rental" /></label>
            <label>Geography<input name="geography" placeholder="India · multi-city" /></label>
            <label>Provenance<select name="provenance" defaultValue="adapted"><option value="observed">Observed</option><option value="adapted">Adapted</option><option value="exploratory">Exploratory</option></select></label>
            <label>Priority<select name="priority" defaultValue="medium"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="monitor">Monitor</option></select></label>
            <label className="full">Why this intent exists<textarea name="provenance_reason" placeholder="Derived from verified rental capability and multi-location operating evidence." required /></label>
            <label>Constraints <small>one per line</small><textarea name="constraints" placeholder={'Rental required\nOne supplier preferred\nMulti-location delivery'} /></label>
            <label>Required capabilities <small>one per line</small><textarea name="required_capabilities" placeholder={'Scaffolding rental\nDelivery\nInstallation / support'} /></label>
            <div className="full manual-intent-actions"><PendingButton pendingLabel="Adding candidate…">Add candidate intent</PendingButton></div>
          </form>
        </details>
      )}
    </div>
  )
}
