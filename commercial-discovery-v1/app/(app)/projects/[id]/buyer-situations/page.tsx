import { createClient } from '@/lib/supabase/server'
import { addIntentCandidate, approveIntent, rejectIntent } from './actions'

export default async function BuyerSituationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: intents }, { data: profile }] = await Promise.all([
    supabase.from('buyer_intents').select('id,intent_key,title,buyer,job_to_be_done,provenance,provenance_reason,priority,status,commercial_model,geography,constraints,required_capabilities').eq('project_id', id).order('created_at'),
    supabase.from('company_profile_versions').select('status,company_name').eq('project_id', id).eq('is_current', true).single(),
  ])

  const error = typeof query.error === 'string' ? query.error : null
  const message = typeof query.message === 'string' ? query.message : null
  const unlocked = profile?.status === 'approved'
  const approvedCount = intents?.filter((intent) => intent.status === 'approved').length ?? 0

  return (
    <div className="project-page">
      <section className="page-header compact">
        <div>
          <div className="eyebrow">WHERE SHOULD WE BE CONSIDERED?</div>
          <h1>Buyer Situations</h1>
          <p>Riseklix models buyer + job + constraints + capabilities + geography + commercial model first. Prompt expressions and competitors are generated underneath an approved intent rather than becoming the product itself.</p>
        </div>
      </section>

      {error && <div className="form-alert error">{error}</div>}
      {message && <div className="form-alert success">{message}</div>}

      <section className={`intent-engine-state ${unlocked ? 'unlocked' : ''}`}>
        <div>
          <div className="eyebrow">BUYER INTENT ENGINE</div>
          <h2>{unlocked ? 'Company context approved. Intent generation is unlocked.' : 'Approve Company Intelligence first.'}</h2>
          <p>{unlocked ? `${approvedCount} buyer situation${approvedCount === 1 ? '' : 's'} currently approved. The automated suggestor will populate candidate intents here once the model provider is wired.` : 'Riseklix will not generate confident-looking prompts from an unapproved understanding of the business.'}</p>
        </div>
        <span>{unlocked ? 'READY' : 'LOCKED'}</span>
      </section>

      {!!intents?.length && (
        <div className="intent-list review-intents">
          {intents.map((intent) => (
            <article key={intent.id} className={intent.status === 'rejected' ? 'intent-rejected' : ''}>
              <div className="intent-meta"><span>{intent.intent_key}</span><span>{intent.provenance}</span><span>{intent.priority}</span><span>{intent.status}</span></div>
              <h2>{intent.title}</h2>
              <p>{intent.job_to_be_done}</p>
              <div className="intent-facts">
                <div><small>Buyer</small><strong>{intent.buyer || 'Not specified'}</strong></div>
                <div><small>Commercial model</small><strong>{intent.commercial_model || 'Not specified'}</strong></div>
                <div><small>Geography</small><strong>{intent.geography && typeof intent.geography === 'object' && !Array.isArray(intent.geography) && 'primary' in intent.geography ? String(intent.geography.primary) : 'Not specified'}</strong></div>
              </div>
              <details className="intent-details">
                <summary>Why this situation exists</summary>
                <p>{intent.provenance_reason || 'No provenance rationale recorded.'}</p>
                <div className="intent-detail-columns">
                  <div><small>Constraints</small><pre>{JSON.stringify(intent.constraints ?? [], null, 2)}</pre></div>
                  <div><small>Required capabilities</small><pre>{JSON.stringify(intent.required_capabilities ?? [], null, 2)}</pre></div>
                </div>
              </details>
              {intent.status === 'candidate' && (
                <div className="intent-actions">
                  <form action={approveIntent}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="intent_id" value={intent.id} /><button>Approve</button></form>
                  <form action={rejectIntent}><input type="hidden" name="project_id" value={id} /><input type="hidden" name="intent_id" value={intent.id} /><button className="reject">Reject</button></form>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {!intents?.length && <div className="empty-state"><h2>No buyer situations yet.</h2><p>{unlocked ? 'The automated Buyer Intent Suggestor is the next model-backed milestone. For QA, you can add a structured candidate manually below.' : 'They will be generated only after the company profile is reviewed and approved.'}</p></div>}

      {unlocked && (
        <details className="manual-intent-panel">
          <summary>Internal QA · add a structured Buyer Intent manually</summary>
          <p>This is a development fallback, not the final customer workflow. It lets us validate the intent schema and downstream review UX before connecting the differentiated Suggestor model.</p>
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
            <div className="full manual-intent-actions"><button type="submit">Add candidate intent</button></div>
          </form>
        </details>
      )}
    </div>
  )
}
