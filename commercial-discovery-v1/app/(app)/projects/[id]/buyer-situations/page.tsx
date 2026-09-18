import { createClient } from '@/lib/supabase/server'
import { addIntentCandidate, approveIntent, rejectIntent } from './actions'
import { generateBuyerIntents } from './generate-actions'
import { discoverCompetitors } from './competitor-actions'
import { approvePromptExpression, generatePromptExpressions, rejectPromptExpression } from './prompt-actions'
import { PendingButton } from '@/components/pending-button'
import { ResearchJobWatcher } from '@/components/research-job-watcher'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function evidenceItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(record).filter((item) => typeof item.url === 'string')
}

export default async function BuyerSituationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: intents }, { data: profile }, { data: latestJob }, { data: competitors }, { data: prompts }] = await Promise.all([
    supabase.from('buyer_intents').select('id,intent_key,title,buyer,job_to_be_done,provenance,provenance_reason,priority,status,commercial_model,geography,constraints,required_capabilities,purchase_stage,language_policy,source_refs').eq('project_id', id).order('created_at'),
    supabase.from('company_profile_versions').select('status,company_name').eq('project_id', id).eq('is_current', true).single(),
    supabase.from('research_jobs').select('id,status,stage,progress,output,error,created_at').eq('project_id', id).eq('job_type', 'intent_generation').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('competitor_candidates').select('id,buyer_intent_id,company_name,domain,relationship,discovery_layer,status,matched_constraints,relaxed_constraints,evidence,evidence_strength,rationale,is_current').eq('project_id', id).eq('is_current', true).order('discovery_layer').order('company_name'),
    supabase.from('prompt_expressions').select('id,buyer_intent_id,language,mode,variant_no,prompt_text,status,is_frozen,version').eq('project_id', id).order('language').order('mode').order('variant_no'),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const unlocked = profile?.status === 'approved'
  const approvedCount = intents?.filter((intent) => intent.status === 'approved').length ?? 0
  const candidateCount = intents?.filter((intent) => intent.status === 'candidate').length ?? 0

  return (
    <div className="project-page">
      <ResearchJobWatcher active={latestJob?.status === 'running'} />
      <section className="page-header compact">
        <div>
          <div className="eyebrow">WHERE SHOULD WE BE CONSIDERED?</div>
          <h1>Buyer Situations</h1>
          <p>Riseklix models the commercial situation first, discovers a defensible competitor universe second, and only then creates controlled prompt expressions for observation.</p>
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
        </div>
        {unlocked ? (
          <form action={generateBuyerIntents} className="intent-generate-form">
            <input type="hidden" name="project_id" value={id} />
            <PendingButton pendingLabel="Generating situations…">{candidateCount ? 'Reuse / generate candidates' : 'Generate Buyer Situations'}</PendingButton>
          </form>
        ) : <span>LOCKED</span>}
      </section>

      {!!intents?.length && (
        <section className="intent-summary-strip" aria-label="Buyer Situation review status">
          <div><span>Awaiting review</span><strong>{candidateCount}</strong></div>
          <div><span>Approved</span><strong>{approvedCount}</strong></div>
          <div><span>Competitor sets ready</span><strong>{new Set((competitors ?? []).map((item) => item.buyer_intent_id)).size}</strong></div>
          <div><span>Question sets started</span><strong>{new Set((prompts ?? []).map((item) => item.buyer_intent_id)).size}</strong></div>
        </section>
      )}

      {!!intents?.length && (
        <div className="intent-list review-intents">
          {intents.map((intent) => {
            const intentCompetitors = (competitors ?? []).filter((competitor) => competitor.buyer_intent_id === intent.id)
            const intentPrompts = (prompts ?? []).filter((prompt) => prompt.buyer_intent_id === intent.id)
            const approvedPrompts = intentPrompts.filter((prompt) => prompt.status === 'approved').length

            return (
              <article key={intent.id} className={intent.status === 'rejected' ? 'intent-rejected' : ''}>
                <div className="intent-meta"><span>{intent.intent_key}</span><span>{intent.provenance}</span><span>{intent.priority}</span><span>{intent.status}</span></div>
                <h2>{intent.title}</h2>
                <p>{intent.job_to_be_done}</p>
                <div className="intent-facts">
                  <div><small>Buyer</small><strong>{intent.buyer || 'Not specified'}</strong></div>
                  <div><small>Commercial model</small><strong>{intent.commercial_model || 'Not specified'}</strong></div>
                  <div><small>Geography</small><strong>{intent.geography && typeof intent.geography === 'object' && !Array.isArray(intent.geography) && 'primary' in intent.geography ? String(intent.geography.primary) : 'Not specified'}</strong></div>
                  <div><small>Purchase stage</small><strong>{intent.purchase_stage || 'Not specified'}</strong></div>
                </div>

                <details className="intent-details">
                  <summary>Why Riseklix thinks this situation belongs here</summary>
                  <p>{intent.provenance_reason || 'No provenance rationale recorded.'}</p>
                  <div className="intent-detail-columns">
                    <div><small>Constraints</small><pre>{JSON.stringify(intent.constraints ?? [], null, 2)}</pre></div>
                    <div><small>Required capabilities</small><pre>{JSON.stringify(intent.required_capabilities ?? [], null, 2)}</pre></div>
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
                        <span>Question expressions</span><strong>{intentPrompts.length ? approvedPrompts + '/' + intentPrompts.length + ' approved' : 'Not generated'}</strong>
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
                        <span><strong>Question expressions</strong><small>How this intent will be tested without changing its commercial meaning.</small></span>
                        <span>{intentPrompts.length ? approvedPrompts + '/' + intentPrompts.length : '—'}</span>
                      </summary>
                      <section className="prompt-section">
                      <div className="prompt-heading">
                        <div>
                          <div className="eyebrow">CONTROLLED QUESTION EXPRESSIONS</div>
                          <h3>{intentPrompts.length ? `${approvedPrompts}/${intentPrompts.length} approved` : 'Generate wording only after the competitor universe is known.'}</h3>
                          <p>Unaided questions never contain the target brand. Aided controls test whether AI understands the same company inside the same buying situation.</p>
                        </div>
                        {!!intentCompetitors.length && !intentPrompts.length && (
                          <form action={generatePromptExpressions}>
                            <input type="hidden" name="project_id" value={id} />
                            <input type="hidden" name="intent_id" value={intent.id} />
                            <input type="hidden" name="regenerate" value="false" />
                            <PendingButton pendingLabel="Generating questions…">Generate question expressions</PendingButton>
                          </form>
                        )}
                      </div>

                      {!!intentPrompts.length && (
                        <div className="prompt-list">
                          {intentPrompts.map((prompt) => (
                            <div className={`prompt-card prompt-${prompt.status}`} key={prompt.id}>
                              <div className="prompt-card-meta"><span>{prompt.language}</span><span>{prompt.mode}</span><span>v{prompt.version}.{prompt.variant_no}</span><span>{prompt.status}</span>{prompt.is_frozen && <span>frozen</span>}</div>
                              <p>{prompt.prompt_text}</p>
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
