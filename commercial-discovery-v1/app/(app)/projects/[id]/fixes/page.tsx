import { createClient } from '@/lib/supabase/server'
import { approveBlueprint, chooseDiyMethod, chooseDiyTool, chooseExecutionRoute, generateBlueprint, updateImplementationTask } from './actions'
import { PendingButton } from '@/components/pending-button'
import { ResearchJobWatcher } from '@/components/research-job-watcher'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function strings(value: unknown) {
  return array(value).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function shortUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '')
  } catch {
    return value
  }
}

function Checklist({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  if (!items.length) return <p className="spec-empty">Nothing additional required.</p>
  const Tag = ordered ? 'ol' : 'ul'
  return <Tag className={ordered ? 'spec-steps' : 'spec-checklist'}>{items.map((item, index) => <li key={index}>{item}</li>)}</Tag>
}

export default async function FixesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: findings }, { data: blueprints }, { data: tasks }, { data: intents }, { data: sources }, { data: blueprintJobs }] = await Promise.all([
    supabase.from('findings').select('id,buyer_intent_id,finding_type,severity,decision,explanation,evidence_strength,review_status,is_current').eq('project_id', id).eq('is_current', true).order('created_at'),
    supabase.from('blueprints').select('id,finding_id,version,status,title,objective,target_url,suggested_h1,required_sections,evidence_required,claims_to_verify,internal_links,structured_data,acceptance_criteria,generated_content,source_refs,created_at').eq('project_id', id).order('created_at'),
    supabase.from('implementation_tasks').select('id,blueprint_id,route,status,assignee_user_id,external_assignee,due_at,delivery_evidence,verification_result,created_at').eq('project_id', id).order('created_at'),
    supabase.from('buyer_intents').select('id,intent_key,title').eq('project_id', id),
    supabase.from('research_sources').select('id,title,url,source_type').eq('project_id', id),
    supabase.from('research_jobs').select('id,status,stage,progress,input,error,created_at,completed_at').eq('project_id', id).eq('job_type', 'blueprint').order('created_at', { ascending: false }).limit(30),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const intentById = new Map((intents ?? []).map((intent) => [intent.id, intent]))
  const sourceById = new Map((sources ?? []).map((source) => [source.id, source]))

  const latestByFinding = new Map<string, NonNullable<typeof blueprints>[number]>()
  for (const blueprint of blueprints ?? []) {
    const current = latestByFinding.get(blueprint.finding_id)
    if (!current || blueprint.version > current.version) latestByFinding.set(blueprint.finding_id, blueprint)
  }
  const latestBlueprints = Array.from(latestByFinding.values())
  const taskByBlueprint = new Map<string, NonNullable<typeof tasks>[number]>()
  for (const task of tasks ?? []) if (!taskByBlueprint.has(task.blueprint_id)) taskByBlueprint.set(task.blueprint_id, task)

  const actionFindings = (findings ?? []).filter((finding) => finding.review_status === 'approved' && finding.decision === 'fix')
  const pendingBlueprints = actionFindings.filter((finding) => !latestByFinding.has(finding.id))
  const activeBlueprintJobs = (blueprintJobs ?? []).filter((job) => job.status === 'running' || job.status === 'queued')
  const activeFindingIds = new Set(activeBlueprintJobs.map((job) => {
    const input = record(job.input)
    return typeof input.finding_id === 'string' ? input.finding_id : ''
  }).filter(Boolean))
  const failedJobByFinding = new Map<string, NonNullable<typeof blueprintJobs>[number]>()
  for (const job of blueprintJobs ?? []) {
    if (job.status !== 'failed') continue
    const input = record(job.input)
    const findingId = typeof input.finding_id === 'string' ? input.finding_id : ''
    if (findingId && !failedJobByFinding.has(findingId)) failedJobByFinding.set(findingId, job)
  }

  const routes = [
    ['diy', 'Do it myself', 'Keep the work in your hands. Next, choose whether you are implementing with AI or manually.'],
    ['internal_team', 'Send to my team', 'Turn this Blueprint into a scoped work order for your developer, writer or internal owner.'],
    ['expert', 'Hire a vetted specialist', 'Route the exact scope to a Riseklix-vetted specialist without restarting discovery.'],
    ['managed', 'Let Riseklix handle it', 'Use the same Blueprint as the scope for managed implementation by Riseklix.'],
  ] as const

  return (
    <div className="project-page">
      <ResearchJobWatcher active={activeBlueprintJobs.length > 0} intervalMs={3000} />
      <section className="page-header compact">
        <div>
          <div className="eyebrow">WHAT SHOULD WE CHANGE?</div>
          <h1>Fixes</h1>
          <p>Only an approved WHY finding with a “fix” decision can become a Blueprint. The Blueprint is included in the product; execution routing changes who does the work, not the evidence or scope.</p>
        </div>
      </section>

      {error && <div className="form-alert error" role="alert">{error}</div>}
      {message && <div className="form-alert success" role="status" aria-live="polite">{message}</div>}

      {!!pendingBlueprints.length && (
        <section className="blueprint-queue">
          <div className="eyebrow">ACTION JUSTIFIED · BLUEPRINT NEEDED</div>
          <div className="blueprint-queue-list">
            {pendingBlueprints.map((finding) => {
              const intent = finding.buyer_intent_id ? intentById.get(finding.buyer_intent_id) : null
              return (
                <article key={finding.id}>
                  <div><span>{finding.finding_type.replaceAll('_', ' ')}</span><h2>{intent?.title || 'Approved diagnostic finding'}</h2><p>{finding.explanation || 'Approved evidence supports implementation work.'}</p></div>
                  <form action={generateBlueprint}>
                    <input type="hidden" name="project_id" value={id} />
                    <input type="hidden" name="finding_id" value={finding.id} />
                    <input type="hidden" name="regenerate" value="false" />
                    <PendingButton
                      pendingLabel="Building Blueprint…"
                      disabled={activeFindingIds.has(finding.id)}
                    >
                      {activeFindingIds.has(finding.id) ? 'Building Blueprint…' : 'Generate Blueprint'}
                    </PendingButton>
                    {failedJobByFinding.has(finding.id) && !activeFindingIds.has(finding.id) && (
                      <small className="form-inline-error">
                        {String(record(failedJobByFinding.get(finding.id)?.error).message || 'The last Blueprint attempt failed. You can retry safely.')}
                      </small>
                    )}
                  </form>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <div className="blueprint-stack">
        {latestBlueprints.map((blueprint) => {
          const finding = (findings ?? []).find((item) => item.id === blueprint.finding_id)
          const intent = finding?.buyer_intent_id ? intentById.get(finding.buyer_intent_id) : null
          const task = taskByBlueprint.get(blueprint.id)
          const executionMeta = record(task?.external_assignee)
          const diyMethod = typeof executionMeta.execution_method === 'string' ? executionMeta.execution_method : null
          const diyTool = typeof executionMeta.ai_tool === 'string' ? executionMeta.ai_tool : null
          const content = record(blueprint.generated_content)
          const structure = record(blueprint.structured_data)
          const refs = Array.isArray(blueprint.source_refs) ? blueprint.source_refs.filter((ref): ref is string => typeof ref === 'string') : []
          const evidenceSources = refs.map((ref) => sourceById.get(ref)).filter(Boolean)

          return (
            <article className="blueprint-card" key={blueprint.id}>
              <header>
                <div className="blueprint-badges"><span>v{blueprint.version}</span><span>{blueprint.status}</span>{finding && <span>{finding.evidence_strength} diagnostic evidence</span>}{task && <span>{task.route.replaceAll('_', ' ')}</span>}</div>
                {intent && <small>{intent.intent_key}</small>}
              </header>
              <h2>{blueprint.title}</h2>
              <p className="blueprint-objective">{blueprint.objective}</p>

              <div className="blueprint-core">
                <div><small>Target</small><strong>{blueprint.target_url || 'Sitewide / evidence asset'}</strong></div>
                <div><small>Suggested H1</small><strong>{blueprint.suggested_h1 || 'No H1 change required'}</strong></div>
                <div><small>Target mode</small><strong>{typeof content.target_mode === 'string' ? content.target_mode.replaceAll('_', ' ') : 'Not recorded'}</strong></div>
                <div><small>Execution</small><strong>{task ? `${task.route.replaceAll('_', ' ')} · ${task.status.replaceAll('_', ' ')}` : 'Not routed'}</strong></div>
              </div>

              {typeof content.implementation_brief === 'string' && <div className="implementation-brief"><small>Implementation brief</small><p>{content.implementation_brief}</p></div>}
              {typeof content.opening_answer === 'string' && <div className="opening-answer"><small>Answer-first draft</small><p>{content.opening_answer}</p></div>}

              <details className="blueprint-details" id={`blueprint-${blueprint.id}-spec`}>
                <summary>Open implementation plan</summary>
                <div className="blueprint-spec-grid">
                  <section className="spec-span-2">
                    <small>Page / asset requirements</small>
                    <div className="spec-section-stack">
                      {array(blueprint.required_sections).map((item, index) => {
                        const section = record(item)
                        return (
                          <article className="spec-item" key={index}>
                            <div className="spec-number">{String(index + 1).padStart(2, '0')}</div>
                            <div>
                              <strong>{String(section.heading ?? `Section ${index + 1}`)}</strong>
                              <p>{String(section.purpose ?? '')}</p>
                              <Checklist items={strings(section.requirements)} />
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </section>

                  <section>
                    <small>Evidence needed before publishing</small>
                    <div className="evidence-needed-list">
                      {array(blueprint.evidence_required).map((item, index) => {
                        const evidence = record(item)
                        return (
                          <article key={index}>
                            <strong>{String(evidence.item ?? `Evidence ${index + 1}`)}</strong>
                            <p>{String(evidence.why ?? '')}</p>
                          </article>
                        )
                      })}
                    </div>
                  </section>

                  <section>
                    <small>Claims to verify</small>
                    <Checklist items={strings(blueprint.claims_to_verify)} />
                  </section>

                  <section className="spec-span-2">
                    <small>Internal links to add</small>
                    <div className="internal-link-list">
                      {array(blueprint.internal_links).map((item, index) => {
                        const link = record(item)
                        return (
                          <article key={index}>
                            <div><span>From</span><strong>{shortUrl(link.from_url)}</strong></div>
                            <div><span>To</span><strong>{shortUrl(link.to_url)}</strong></div>
                            <p>{String(link.anchor_intent ?? '')}</p>
                          </article>
                        )
                      })}
                      {!array(blueprint.internal_links).length && <p className="spec-empty">No internal-link change is required for this Blueprint.</p>}
                    </div>
                  </section>

                  <section>
                    <small>Structured data</small>
                    <strong className="spec-lead">{Array.isArray(structure.recommended_types) && structure.recommended_types.length ? structure.recommended_types.join(', ') : 'No markup automatically justified'}</strong>
                    <p>{String(structure.reason ?? '')}</p>
                    <Checklist items={strings(structure.prerequisites)} />
                  </section>

                  <section>
                    <small>Definition of done</small>
                    <Checklist items={strings(blueprint.acceptance_criteria)} />
                  </section>

                  <section>
                    <small>Content guidance</small>
                    <Checklist items={strings(content.content_notes)} />
                  </section>

                  <section>
                    <small>Developer notes</small>
                    <Checklist items={strings(content.technical_notes)} />
                  </section>

                  <section className="spec-span-2">
                    <small>After implementation</small>
                    <Checklist items={strings(content.measurement_plan)} ordered />
                  </section>
                </div>
              </details>

              {!!evidenceSources.length && (
                <details className="blueprint-evidence"><summary>{evidenceSources.length} source{evidenceSources.length === 1 ? '' : 's'} attached to this Blueprint</summary><div>{evidenceSources.map((source) => source && <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span>{source.source_type.replaceAll('_', ' ')}</span><strong>{source.title || source.url}</strong></a>)}</div></details>
              )}

              {blueprint.status === 'draft' && (
                <div className="blueprint-approval">
                  <div><strong>Review before execution.</strong><p>Approval confirms the implementation scope—not that every unverified claim in the brief is true.</p></div>
                  <form action={approveBlueprint}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="blueprint_id" value={blueprint.id} /><PendingButton pendingLabel="Approving…">Approve Blueprint</PendingButton></form>
                </div>
              )}

              {['approved', 'in_progress', 'implemented', 'verified'].includes(blueprint.status) && (
                <section className="execution-routes">
                  <div className="execution-step-head">
                    <span>01</span>
                    <div>
                      <div className="eyebrow">HOW DO YOU WANT THIS IMPLEMENTED?</div>
                      <h3>Choose who owns the work.</h3>
                      <p>Riseklix keeps the approved scope fixed. The execution path only changes who carries it out.</p>
                    </div>
                  </div>
                  <div className="execution-route-grid">
                    {routes.map(([route, title, description]) => (
                      <form action={chooseExecutionRoute} className={task?.route === route ? 'route-selected' : ''} key={route}>
                        <input type="hidden" name="project_id" value={id} />
                        <input type="hidden" name="blueprint_id" value={blueprint.id} />
                        <input type="hidden" name="route" value={route} />
                        <strong>{title}</strong><p>{description}</p><PendingButton pendingLabel="Routing…">{task?.route === route ? 'Selected' : 'Use this path'}</PendingButton>
                      </form>
                    ))}
                  </div>

                  {task?.route === 'diy' && (
                    <div className="diy-execution-flow">
                      <div className="execution-step-head">
                        <span>02</span>
                        <div>
                          <div className="eyebrow">HOW WILL YOU EXECUTE IT?</div>
                          <h3>Choose your DIY method.</h3>
                          <p>We only ask about a specific AI workspace after you choose to implement with AI.</p>
                        </div>
                      </div>

                      <div className="execution-method-grid">
                        <form action={chooseDiyMethod} className={diyMethod === 'ai' ? 'route-selected' : ''}>
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="blueprint_id" value={blueprint.id} />
                          <input type="hidden" name="method" value="ai" />
                          <strong>Use AI to implement</strong>
                          <p>Riseklix will adapt this Blueprint into a tightly scoped implementation pack for your AI workspace.</p>
                          <PendingButton pendingLabel="Selecting…">{diyMethod === 'ai' ? 'Selected' : 'Choose AI'}</PendingButton>
                        </form>

                        <form action={chooseDiyMethod} className={diyMethod === 'manual' ? 'route-selected' : ''}>
                          <input type="hidden" name="project_id" value={id} />
                          <input type="hidden" name="blueprint_id" value={blueprint.id} />
                          <input type="hidden" name="method" value="manual" />
                          <strong>Implement manually</strong>
                          <p>Use the human-readable Blueprint as a developer-ready work order without an AI coding workspace.</p>
                          <PendingButton pendingLabel="Selecting…">{diyMethod === 'manual' ? 'Selected' : 'Use developer brief'}</PendingButton>
                        </form>
                      </div>

                      {diyMethod === 'ai' && (
                        <div className="ai-workspace-step">
                          <div className="execution-step-head compact-step">
                            <span>03</span>
                            <div>
                              <div className="eyebrow">AI WORKSPACE</div>
                              <h3>Where will you run the implementation?</h3>
                              <p>This choice will control the prompt format and project-context instructions.</p>
                            </div>
                          </div>
                          <div className="ai-workspace-grid">
                            {[
                              ['lovable', 'Lovable', 'Component-scoped prompt with strong preserve-the-existing-design constraints.'],
                              ['claude_code', 'Claude Code', 'Repository-aware work order designed to sit alongside project instructions.'],
                              ['codex', 'Codex', 'Repository-scoped task designed to respect AGENTS.md instructions and existing checks.'],
                              ['other_ai', 'Other AI workspace', 'Tool-neutral implementation pack for Cursor, Replit, Bolt or another coding assistant.'],
                            ].map(([tool, title, description]) => (
                              <form action={chooseDiyTool} className={diyTool === tool ? 'route-selected' : ''} key={tool}>
                                <input type="hidden" name="project_id" value={id} />
                                <input type="hidden" name="blueprint_id" value={blueprint.id} />
                                <input type="hidden" name="tool" value={tool} />
                                <strong>{title}</strong>
                                <p>{description}</p>
                                <PendingButton pendingLabel="Selecting…">{diyTool === tool ? 'Selected' : `Use ${title}`}</PendingButton>
                              </form>
                            ))}
                          </div>
                          {diyTool && (
                            <div className="execution-ready-note">
                              <strong>Execution context selected.</strong>
                              <p>The next DIY layer can generate the implementation pack from this approved Blueprint without re-running discovery.</p>
                            </div>
                          )}
                        </div>
                      )}

                      {diyMethod === 'manual' && (
                        <div className="execution-ready-note">
                          <strong>Developer brief ready.</strong>
                          <p>The implementation plan above is the work order: scope, evidence requirements, claims to verify, links, technical notes and definition of done are already separated for handoff.</p>
                          <a href={`#blueprint-${blueprint.id}-spec`}>Review implementation plan</a>
                        </div>
                      )}
                    </div>
                  )}

                  {task && (
                    <form action={updateImplementationTask} className="delivery-workflow">
                      <input type="hidden" name="project_id" value={id} />
                      <input type="hidden" name="blueprint_id" value={blueprint.id} />
                      <input type="hidden" name="task_id" value={task.id} />

                      <div className="delivery-workflow-head">
                        <div>
                          <div className="eyebrow">DELIVERY · SEPARATE FROM IMPACT</div>
                          <h3>Where is this work right now?</h3>
                          <p>Marking delivery verified confirms the Blueprint was implemented. It does not claim the AI outcome changed; that belongs in Recheck.</p>
                        </div>
                        <span>{task.status.replaceAll('_', ' ')}</span>
                      </div>

                      <div className="delivery-inputs">
                        <label>Live URL <small>optional until review</small><input name="delivery_url" type="url" placeholder="https://company.com/implemented-page" /></label>
                        <label>Delivery note <small>optional</small><textarea name="notes" placeholder="What changed, what remains unresolved, or what the reviewer should check." /></label>
                      </div>

                      <div className="delivery-status-actions">
                        <PendingButton name="status" value="in_progress" pendingLabel="Updating…" className={task.status === 'in_progress' ? 'active' : ''}>In progress</PendingButton>
                        <PendingButton name="status" value="ready_for_review" pendingLabel="Updating…" className={task.status === 'ready_for_review' ? 'active' : ''}>Ready for review</PendingButton>
                        <PendingButton name="status" value="verified" pendingLabel="Verifying…" className={task.status === 'verified' ? 'active verified' : 'verified'}>Verify delivery</PendingButton>
                      </div>
                    </form>
                  )}
                </section>
              )}
            </article>
          )
        })}
      </div>

      {!latestBlueprints.length && !pendingBlueprints.length && <div className="empty-state"><h2>No fixes justified yet.</h2><p>That is intentional. Riseklix does not manufacture work before an approved diagnostic finding supports it.</p></div>}
    </div>
  )
}
