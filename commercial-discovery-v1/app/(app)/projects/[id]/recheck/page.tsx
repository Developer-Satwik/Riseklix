import { createClient } from '@/lib/supabase/server'
import { createBaselinePanel } from './actions'

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default async function RecheckPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [{ data: benchmarks }, { data: expressions }, { data: memberships }] = await Promise.all([
    supabase.from('benchmarks').select('id,benchmark_type,status,version,started_at,completed_at,parent_benchmark_id,collection_config,created_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('prompt_expressions').select('id,buyer_intent_id,language,mode,status,is_frozen').eq('project_id', id),
    supabase.from('benchmark_prompts').select('benchmark_id,prompt_expression_id,buyer_intent_id').eq('project_id', id),
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
            return (
              <article key={benchmark.id}>
                <div className="benchmark-top"><span>{benchmark.benchmark_type} v{benchmark.version}</span><strong>{benchmark.status}</strong></div>
                <h2>{benchmark.benchmark_type === 'baseline' ? 'Frozen comparison point' : 'Comparable recheck'}</h2>
                <div className="benchmark-facts">
                  <div><small>Question expressions</small><strong>{promptCount}</strong></div>
                  <div><small>Buyer intents</small><strong>{typeof config.intent_count === 'number' ? config.intent_count : '—'}</strong></div>
                  <div><small>Repetitions</small><strong>{typeof config.repetitions_per_expression === 'number' ? config.repetitions_per_expression : '—'}</strong></div>
                  <div><small>Providers</small><strong>{Array.isArray(config.providers) && config.providers.length ? config.providers.join(', ') : 'Not configured'}</strong></div>
                </div>
                <p>{benchmark.completed_at ? `Completed ${new Date(benchmark.completed_at).toLocaleString()}` : benchmark.started_at ? `Started ${new Date(benchmark.started_at).toLocaleString()}` : 'Panel is frozen. Observation providers still need to be configured before collection begins.'}</p>
              </article>
            )
          })}
        </div>
      )}

      {!benchmarks?.length && !eligibleIntentCount && <div className="empty-state"><h2>No benchmark yet.</h2><p>The first baseline becomes available after reviewed Buyer Intents have approved unaided and aided question expressions.</p></div>}

      {baseline && (
        <section className="next-step-panel">
          <div className="eyebrow">NEXT ENGINEERING STAGE</div>
          <h2>Connect declared observation providers to the frozen panel.</h2>
          <p>Every run will preserve provider, surface, model label, session policy, language, geography, repetition, full answer, citations and capture state. NR and NC remain separate.</p>
        </section>
      )}
    </div>
  )
}
