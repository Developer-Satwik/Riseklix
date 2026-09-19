import { createClient } from '@/lib/supabase/server'
import { approveBlueprint, chooseExecutionRoute, generateBlueprint, updateImplementationTask } from './actions'
import { PendingButton } from '@/components/pending-button'
import { ResearchJobWatcher } from '@/components/research-job-watcher'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
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
    ['diy', 'Do it myself', 'Use the full implementation brief, evidence checklist and acceptance criteria yourself.'],
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

              <details className="blueprint-details">
                <summary>Open complete implementation specification</summary>
                <div className="blueprint-spec-grid">
                  <section><small>Required sections</small>{array(blueprint.required_sections).map((item, index) => { const section = record(item); return <div className="spec-item" key={index}><strong>{String(section.heading ?? `Section ${index + 1}`)}</strong><p>{String(section.purpose ?? '')}</p><pre>{JSON.stringify(section.requirements ?? [], null, 2)}</pre></div> })}</section>
                  <section><small>Evidence required</small>{array(blueprint.evidence_required).map((item, index) => { const evidence = record(item); return <div className="spec-item" key={index}><strong>{String(evidence.item ?? `Evidence ${index + 1}`)}</strong><p>{String(evidence.why ?? '')}</p></div> })}</section>
                  <section><small>Claims to verify before publishing</small><pre>{JSON.stringify(blueprint.claims_to_verify ?? [], null, 2)}</pre></section>
                  <section><small>Internal links</small><pre>{JSON.stringify(blueprint.internal_links ?? [], null, 2)}</pre></section>
                  <section><small>Structured data</small><strong>{Array.isArray(structure.recommended_types) && structure.recommended_types.length ? structure.recommended_types.join(', ') : 'No markup automatically justified'}</strong><p>{String(structure.reason ?? '')}</p><pre>{JSON.stringify(structure.prerequisites ?? [], null, 2)}</pre></section>
                  <section><small>Acceptance criteria</small><pre>{JSON.stringify(blueprint.acceptance_criteria ?? [], null, 2)}</pre></section>
                  <section><small>Content notes</small><pre>{JSON.stringify(content.content_notes ?? [], null, 2)}</pre></section>
                  <section><small>Technical notes</small><pre>{JSON.stringify(content.technical_notes ?? [], null, 2)}</pre></section>
                  <section><small>Measurement plan</small><pre>{JSON.stringify(content.measurement_plan ?? [], null, 2)}</pre></section>
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
                  <div className="eyebrow">CHOOSE WHO EXECUTES THIS ACTION</div>
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
