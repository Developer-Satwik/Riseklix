import Link from 'next/link'
import { createProject } from './actions'
import { PendingButton } from '@/components/pending-button'

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const domain = typeof params.domain === 'string' ? params.domain : ''
  const error = typeof params.error === 'string' ? params.error : null

  return (
    <div className="new-project-shell new-analysis-page">
      <Link href="/projects" className="back-link">← Back to projects</Link>

      <div className="new-analysis-grid">
        <section>
          <div className="eyebrow">NEW ANALYSIS · STEP 1 OF 3</div>
          <h1>Which company should Riseklix investigate?</h1>
          <p>Start with the business, not prompts or keywords. Riseklix will research the company first, then ask you to confirm what it understood before anything is benchmarked.</p>

          {error && <div className="form-alert error" role="alert">{error}</div>}

          <form action={createProject} className="new-project-form">
            <label className="primary-field">Company website
              <input name="domain" defaultValue={domain} placeholder="company.com" autoFocus required />
            </label>
            <fieldset className="analysis-mode-picker">
              <legend>How much control do you want?</legend>
              <label className="analysis-mode-card">
                <input type="radio" name="analysis_mode" value="autopilot" defaultChecked />
                <span>
                  <strong>Let AI do the whole evaluation for me</strong>
                  <small>Recommended · You only confirm the Company Intelligence profile once. After that Riseklix chooses the Buyer Situations, competitors and questions, runs the enabled AI models, and prepares the diagnosis automatically.</small>
                </span>
              </label>
              <label className="analysis-mode-card">
                <input type="radio" name="analysis_mode" value="manual" />
                <span>
                  <strong>Manual Editing</strong>
                  <small>Keep review controls throughout the workflow. Approve or reject Buyer Situations, questions and findings before they move forward.</small>
                </span>
              </label>
            </fieldset>

            <div className="new-project-secondary">
              <label>Primary market
                <select name="market" defaultValue="India">
                  <option>India</option>
                  <option>United States</option>
                  <option>United Kingdom</option>
                  <option>UAE</option>
                  <option>Singapore</option>
                  <option>Australia</option>
                </select>
              </label>
              <label>Industry <small>optional</small>
                <input name="industry" placeholder="e.g. industrial access equipment" />
              </label>
            </div>
            <PendingButton pendingLabel="Creating workspace…">Start company research <span aria-hidden="true">→</span></PendingButton>
            <small className="form-trust-note">Both modes require one Company Intelligence confirmation before the analysis can continue.</small>
          </form>
        </section>

        <aside className="new-analysis-explainer">
          <div className="eyebrow">WHAT HAPPENS NEXT</div>
          <ol>
            <li>
              <span>01</span>
              <div><strong>We research the company.</strong><p>Products, services, buyers, geographies, business model and evidence.</p></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>You confirm our understanding once.</strong><p>The company premise is the one mandatory human checkpoint in either mode.</p></div>
            </li>
            <li>
              <span>03</span>
              <div><strong>Then your chosen mode takes over.</strong><p>Autopilot continues the evaluation automatically; Manual Editing keeps the review gates visible.</p></div>
            </li>
          </ol>
          <blockquote>“In which commercial situations could this company legitimately deserve consideration?”</blockquote>
        </aside>
      </div>
    </div>
  )
}
