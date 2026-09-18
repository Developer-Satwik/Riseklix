import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

function decisionLabel(value: string) {
  return value === 'fix' ? 'Fix' : value === 'investigate' ? 'Investigate' : value === 'monitor' ? 'Monitor' : value === 'healthy' || value === 'no_change' ? 'Healthy' : 'Review'
}

export default async function ProjectOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [
    { data: project },
    { data: profile },
    { data: intents },
    { data: findings },
    { data: blueprints },
    { data: benchmark },
    { data: promptExpressions },
  ] = await Promise.all([
    supabase.from('projects').select('name,domain,market,status,analysis_mode').eq('id', id).single(),
    supabase.from('company_profile_versions').select('status,company_name').eq('project_id', id).eq('is_current', true).maybeSingle(),
    supabase.from('buyer_intents').select('id,status,priority').eq('project_id', id),
    supabase.from('findings').select('id,observed,severity,decision,evidence_strength,review_status,created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(5),
    supabase.from('blueprints').select('id,status,finding_id').eq('project_id', id),
    supabase.from('benchmarks').select('id,status,benchmark_type,completed_at,created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('prompt_expressions').select('buyer_intent_id,mode,status').eq('project_id', id),
  ])

  const { data: surfaces } = benchmark
    ? await supabase.from('benchmark_surfaces').select('id,provider,surface,status,expected_runs,captured_runs,error_runs').eq('benchmark_id', benchmark.id)
    : { data: [] }

  const pageMessage = typeof query.message === 'string' ? query.message : null
  const pageError = typeof query.error === 'string' ? query.error : null

  const approved = intents?.filter((intent) => intent.status === 'approved').length ?? 0
  const candidates = intents?.filter((intent) => intent.status === 'candidate').length ?? 0
  const fixes = findings?.filter((finding) => finding.decision === 'fix').length ?? 0
  const investigations = findings?.filter((finding) => finding.decision === 'investigate').length ?? 0
  const monitoring = findings?.filter((finding) => finding.decision === 'monitor').length ?? 0
  const activeFixes = blueprints?.filter((item) => item.status !== 'verified').length ?? 0
  const verifiedFixes = blueprints?.filter((item) => item.status === 'verified').length ?? 0
  const promptModes = new Map<string, Set<string>>()
  for (const prompt of promptExpressions ?? []) {
    if (prompt.status !== 'approved') continue
    const modes = promptModes.get(prompt.buyer_intent_id) ?? new Set<string>()
    modes.add(prompt.mode)
    promptModes.set(prompt.buyer_intent_id, modes)
  }
  const testReadyIntentCount = Array.from(promptModes.values()).filter((modes) => modes.has('unaided') && modes.has('aided')).length

  let nextHref = `/projects/${id}/company-profile`
  let nextTitle = 'Confirm the company before we test anything.'
  let nextCopy = 'Riseklix needs an approved understanding of the business before Buyer Situations or competitor sets can be trusted.'
  let nextCta = 'Review company profile'

  if (profile?.status === 'approved' && approved === 0) {
    nextHref = `/projects/${id}/buyer-situations`
    nextTitle = candidates ? 'Review the Buyer Situations Riseklix found.' : 'Generate the buying situations worth testing.'
    nextCopy = candidates
      ? `${candidates} candidate situation${candidates === 1 ? '' : 's'} are waiting for a human decision. Nothing enters the benchmark until you approve it.`
      : 'The next step is to model commercially distinct decisions—not a pile of prompt variations.'
    nextCta = 'Open Buyer Situations'
  } else if (approved > 0 && !benchmark && testReadyIntentCount > 0) {
    nextHref = `/projects/${id}/test`
    nextTitle = 'Your approved questions are ready to test.'
    nextCopy = `${testReadyIntentCount} Buyer Situation${testReadyIntentCount === 1 ? '' : 's'} have both buyer questions and brand checks ready for a frozen multi-model baseline.`
    nextCta = 'Run approved questions'
  } else if (approved > 0 && !benchmark) {
    nextHref = `/projects/${id}/buyer-situations`
    nextTitle = 'Finish the question set before testing.'
    nextCopy = 'Each tested Buyer Situation needs an approved buyer question plus an approved brand check.'
    nextCta = 'Review buyer questions'
  } else if (benchmark && benchmark.status !== 'complete') {
    nextHref = `/projects/${id}/test`
    nextTitle = 'Finish the declared AI surfaces.'
    nextCopy = 'The baseline is frozen. Run the same approved questions across each enabled surface without mixing capture errors, NR and pending observations.'
    nextCta = 'Continue tests'
  } else if (benchmark?.status === 'complete' && !findings?.length) {
    nextHref = `/projects/${id}/why`
    nextTitle = 'Interpret the benchmark without inventing certainty.'
    nextCopy = 'The observation set is ready for the WHY layer: what happened, what the controls show, and which explanations are actually supported.'
    nextCta = 'Generate WHY findings'
  } else if (fixes > 0 && activeFixes === 0 && verifiedFixes === 0) {
    nextHref = `/projects/${id}/why`
    nextTitle = 'Approve only the findings that deserve work.'
    nextCopy = 'A diagnosis must survive evidence review before it becomes a Blueprint.'
    nextCta = 'Review findings'
  } else if (activeFixes > 0) {
    nextHref = `/projects/${id}/fixes`
    nextTitle = 'Move the justified work into implementation.'
    nextCopy = `${activeFixes} active Blueprint${activeFixes === 1 ? '' : 's'} can be executed by your team, a specialist, or Riseklix without changing the scope.`
    nextCta = 'Open Fixes'
  } else if (verifiedFixes > 0) {
    nextHref = `/projects/${id}/recheck`
    nextTitle = 'The work is verified. Now measure what changed.'
    nextCopy = 'Delivery and AI impact remain separate facts. Re-run the frozen panel before drawing conclusions.'
    nextCta = 'Open Recheck'
  }

  const attention = fixes + investigations

  return (
    <div className="project-page overview-page">
      {pageError && <div className="form-alert error" role="alert">{pageError}</div>}
      {pageMessage && <div className="form-alert success" role="status" aria-live="polite">{pageMessage}</div>}
      {project?.analysis_mode === 'autopilot' && (
        <section className="autopilot-banner">
          <div>
            <div className="eyebrow">AI AUTOPILOT</div>
            <strong>{project.status === 'complete' ? 'Evaluation complete.' : 'Riseklix is handling the evaluation automatically.'}</strong>
            <p>{project.status === 'complete' ? 'The company profile was the only required confirmation. Review the findings and evidence whenever you want.' : 'After the Company Intelligence confirmation, Buyer Situations, competitors, buyer questions, model testing and WHY analysis advance without additional approval gates.'}</p>
          </div>
          <span>{project.status}</span>
        </section>
      )}
      <section className="overview-hero">
        <div className="eyebrow">CURRENT READ</div>
        <div className="overview-hero-grid">
          <div>
            <h1>
              {benchmark?.status === 'complete'
                ? attention
                  ? `${project?.name} has ${attention} decision${attention === 1 ? '' : 's'} worth your attention.`
                  : `${project?.name} is not showing a justified problem yet.`
                : 'Riseklix is still building the evidence chain.'}
            </h1>
            <p>
              {benchmark?.status === 'complete'
                ? 'The default view is intentionally a short decision brief. Raw prompts, citations, model runs and methodology stay one level deeper when you need the receipts.'
                : 'Each stage unlocks only when the previous premise is trustworthy: company context → Buyer Situations → benchmark → WHY → work → recheck.'}
            </p>
          </div>
          <div className="overview-context">
            <span>{project?.market}</span>
            <strong>{profile?.company_name || project?.name}</strong>
            <small>{project?.domain}</small>
          </div>
        </div>
      </section>

      <section className="decision-strip" aria-label="Project summary">
        <div><span>Approved situations</span><strong>{approved}</strong></div>
        <div><span>Needs action</span><strong>{fixes}</strong></div>
        <div><span>Investigate</span><strong>{investigations}</strong></div>
        <div><span>Monitor</span><strong>{monitoring}</strong></div>
        <div><span>Observation surfaces</span><strong>{surfaces?.length ?? 0}</strong></div>
      </section>

      <section className="spotlight-action">
        <div>
          <div className="eyebrow">NEXT BEST ACTION</div>
          <h2>{nextTitle}</h2>
          <p>{nextCopy}</p>
        </div>
        <Link href={nextHref} className="spotlight-cta">{nextCta}<span aria-hidden="true">→</span></Link>
      </section>

      {!!findings?.length && (
        <section className="overview-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">WHAT MATTERS</div>
              <h2>A short decision brief, not a dashboard graveyard.</h2>
            </div>
            <Link href={`/projects/${id}/why`} className="text-link">Open full WHY view →</Link>
          </div>
          <div className="decision-list">
            {findings.map((finding) => (
              <Link href={`/projects/${id}/why`} className="decision-row" key={finding.id}>
                <div className={`decision-mark ${finding.decision}`} aria-hidden="true" />
                <div className="decision-copy">
                  <div className="decision-meta">
                    <span>{decisionLabel(finding.decision)}</span>
                    <span>{finding.evidence_strength} evidence</span>
                    <span>{finding.review_status}</span>
                  </div>
                  <strong>{finding.observed}</strong>
                </div>
                <span className="decision-arrow" aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!!surfaces?.length && (
        <section className="overview-section subtle-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow">COLLECTION HEALTH</div>
              <h2>Every observation surface stays declared.</h2>
            </div>
            <Link href={`/projects/${id}/recheck`} className="text-link">Inspect benchmark →</Link>
          </div>
          <div className="surface-summary">
            {surfaces.map((surface) => (
              <div key={surface.id}>
                <span>{surface.provider}</span>
                <strong>{surface.status.replaceAll('_', ' ')}</strong>
                <small>{surface.captured_runs}/{surface.expected_runs || '—'} captured · {surface.error_runs} errors</small>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
