import { createProject } from './actions'

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const domain = typeof params.domain === 'string' ? params.domain : ''
  const error = typeof params.error === 'string' ? params.error : null

  return (
    <div className="new-project-shell">
      <div className="eyebrow">NEW ANALYSIS</div>
      <h1>Which company should Riseklix investigate?</h1>
      <p>Start with the business, not a list of prompts. We will build the company context before any benchmark is allowed to run.</p>
      {error && <div className="form-alert error">{error}</div>}
      <form action={createProject} className="new-project-form">
        <label>Company website<input name="domain" defaultValue={domain} placeholder="company.com" required /></label>
        <label>Primary market<select name="market" defaultValue="India"><option>India</option><option>United States</option><option>United Kingdom</option><option>UAE</option><option>Singapore</option><option>Australia</option></select></label>
        <label>Industry <small>optional</small><input name="industry" placeholder="e.g. industrial access equipment" /></label>
        <button type="submit">Create company research workspace →</button>
      </form>
    </div>
  )
}
