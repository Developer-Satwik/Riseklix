import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AutopilotProcessingClient } from '@/components/autopilot-processing-client'

const stages = [
  ['generating_buyer_situations', 'Buyer Situations', 'Modeling the commercial situations where this company could legitimately enter consideration.'],
  ['researching_competitors', 'Competitor universe', 'Validating the companies that actually compete for each buying situation.'],
  ['generating_buyer_questions', 'Buyer questions', 'Turning approved situations into fresh-session discovery and brand-check questions.'],
  ['baseline_ready', 'Benchmark', 'Freezing the questions, market, language and observation surfaces before testing.'],
  ['running_multi_model_tests', 'AI observations', 'Running the same approved questions across the enabled AI systems without mixing failures with non-retrieval.'],
  ['generating_why_analysis', 'WHY analysis', 'Separating observed behavior from the explanations the evidence can support.'],
  ['evaluation_complete', 'Report ready', 'The Commercial Discovery report is ready to review.'],
] as const

function stageIndex(stage?: string | null) {
  if (!stage) return 0
  const normalized = stage.replace(/_paused$/, '')
  const index = stages.findIndex(([key]) => key === normalized)
  return index === -1 ? 0 : index
}

function stageTitle(stage?: string | null) {
  if (!stage) return 'Preparing the analysis'
  const found = stages.find(([key]) => key === stage.replace(/_paused$/, ''))
  return found?.[1] || stage.replaceAll('_', ' ')
}

export default async function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: profile }, { data: run }, { data: jobs }, { data: surfaces }] = await Promise.all([
    supabase
      .from('projects')
      .select('id,name,domain,market,status,analysis_mode')
      .eq('id', id)
      .single(),
    supabase
      .from('company_profile_versions')
      .select('status,company_name')
      .eq('project_id', id)
      .eq('is_current', true)
      .maybeSingle(),
    supabase
      .from('autopilot_runs')
      .select('status,stage,progress,step_count,max_steps,api_call_count,max_api_calls,last_error,updated_at,completed_at')
      .eq('project_id', id)
      .maybeSingle(),
    supabase
      .from('research_jobs')
      .select('id,job_type,status,stage,progress,created_at,completed_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('benchmark_surfaces')
      .select('provider,status,expected_runs,captured_runs,error_runs')
      .eq('project_id', id)
      .eq('enabled', true),
  ])

  if (!project) redirect('/projects')
  if (project.analysis_mode !== 'autopilot') redirect('/projects/' + id + '/overview')
  if (profile?.status !== 'approved') redirect('/projects/' + id + '/company-profile')

  const complete = project.status === 'complete' || run?.status === 'complete' || run?.progress === 100
  if (complete) redirect('/projects/' + id + '/report')

  const paused = run?.status === 'paused' || run?.status === 'failed'
  const currentIndex = stageIndex(run?.stage)
  const activeJobs = (jobs ?? []).filter((job) => job.status === 'running' || job.status === 'queued')
  const captured = (surfaces ?? []).reduce((sum, surface) => sum + Number(surface.captured_runs || 0), 0)
  const expected = (surfaces ?? []).reduce((sum, surface) => sum + Number(surface.expected_runs || 0), 0)

  return (
    <div className="project-page autopilot-processing-page">
      <AutopilotProcessingClient
        projectId={id}
        projectName={profile?.company_name || project.name}
        complete={false}
        paused={paused}
      />

      <section className="processing-hero">
        <div className="processing-orbit" aria-hidden="true">
          <i />
          <span>{run?.progress ?? 10}%</span>
        </div>
        <div>
          <div className="eyebrow">AI AUTOPILOT · ANALYSIS IN PROGRESS</div>
          <h1>Riseklix is building the evidence chain for {profile?.company_name || project.name}.</h1>
          <p>You confirmed the only required premise. From here, the system researches Buyer Situations, validates competitors, freezes the benchmark, runs the enabled AI surfaces, and generates the evidence-bounded WHY layer automatically.</p>
        </div>
      </section>

      {paused ? (
        <section className="processing-paused">
          <div>
            <div className="eyebrow">AUTOPILOT PAUSED</div>
            <h2>{stageTitle(run?.stage)}</h2>
            <p>{run?.last_error || 'Riseklix stopped before making another paid request because a workflow guardrail was reached.'}</p>
          </div>
          <Link href={'/projects/' + id + '/overview'}>Review the issue →</Link>
        </section>
      ) : (
        <>
          <section className="processing-current">
            <div>
              <span>Currently working on</span>
              <h2>{stageTitle(run?.stage)}</h2>
              <p>{activeJobs[0]?.stage ? activeJobs[0].stage.replaceAll('_', ' ') : 'Advancing the next verified research step.'}</p>
            </div>
            <strong>{run?.progress ?? 10}%</strong>
          </section>

          <div className="processing-progress-track" aria-label={(run?.progress ?? 10) + '% complete'}>
            <i style={{ width: (run?.progress ?? 10) + '%' }} />
          </div>
        </>
      )}

      <section className="processing-stage-list" aria-label="Analysis stages">
        {stages.map(([key, title, description], index) => {
          const done = index < currentIndex
          const active = index === currentIndex && !paused
          return (
            <article key={key} className={done ? 'done' : active ? 'active' : ''}>
              <span className="processing-stage-index">{done ? '✓' : String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              <small>{done ? 'Complete' : active ? 'In progress' : 'Queued'}</small>
            </article>
          )
        })}
      </section>

      <section className="processing-live-evidence">
        <div>
          <span>Observation capture</span>
          <strong>{expected ? captured + ' / ' + expected : 'Not started yet'}</strong>
          <small>Captured answers are counted separately from failed or pending runs.</small>
        </div>
        <div>
          <span>Background jobs</span>
          <strong>{activeJobs.length ? activeJobs.length + ' active' : 'Orchestrating'}</strong>
          <small>You do not need to keep clicking through workflow pages.</small>
        </div>
        <div>
          <span>Safety limits</span>
          <strong>{run ? run.api_call_count + ' / ' + run.max_api_calls + ' calls' : 'Active'}</strong>
          <small>Autopilot pauses instead of retrying indefinitely or spending silently.</small>
        </div>
      </section>

      <section className="processing-exit-note">
        <div>
          <div className="eyebrow">YOU CAN LEAVE THIS SCREEN</div>
          <h2>The research keeps running in the background.</h2>
          <p>Keep Riseklix open in this browser if you want a system notification the moment the report is ready. You can also return to Projects and check the analysis later.</p>
        </div>
        <Link href="/projects">Back to projects</Link>
      </section>
    </div>
  )
}
