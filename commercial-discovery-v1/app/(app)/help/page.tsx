import Link from 'next/link'

const guides = [
  {
    label: '01 · START',
    title: 'Run your first analysis',
    body: 'Start with a company URL. Riseklix researches the business first, then asks you to confirm Company Intelligence before any benchmark is created.',
    href: '/projects/new',
    cta: 'Start an analysis',
  },
  {
    label: '02 · MODES',
    title: 'Autopilot vs Manual Editing',
    body: 'Autopilot keeps one mandatory Company Intelligence checkpoint and handles the remaining evaluation. Manual Editing keeps review gates throughout the workflow.',
    href: '/projects/new',
    cta: 'See analysis modes',
  },
  {
    label: '03 · RESULTS',
    title: 'How to read a Riseklix finding',
    body: 'Treat observed model behavior, interpretation and recommended action as separate layers. A model miss is evidence to investigate, not proof of a causal visibility problem.',
    href: '/projects',
    cta: 'Open projects',
  },
]

export default function HelpPage() {
  return (
    <div className="page-wrap help-page">
      <header className="page-header compact help-header">
        <div className="eyebrow">HELP & SUPPORT</div>
        <h1>Get unstuck without leaving the workflow.</h1>
        <p>Quick guidance for the parts of Commercial Discovery users are most likely to need help with, plus a direct support route when something behaves unexpectedly.</p>
      </header>

      <section className="help-guide-grid">
        {guides.map((guide) => (
          <article className="help-guide-card" key={guide.title}>
            <span>{guide.label}</span>
            <h2>{guide.title}</h2>
            <p>{guide.body}</p>
            <Link href={guide.href}>{guide.cta} →</Link>
          </article>
        ))}
      </section>

      <section className="help-troubleshooting">
        <div>
          <div className="eyebrow">COMMON TROUBLESHOOTING</div>
          <h2>Before you assume the analysis is broken.</h2>
        </div>
        <dl>
          <div>
            <dt>Google or Microsoft sign-in loops back to login</dt>
            <dd>Try the production URL rather than a deployment preview. If the issue persists, send the URL you land on to support so we can trace the callback.</dd>
          </div>
          <div>
            <dt>Autopilot looks paused</dt>
            <dd>Open the project Overview. Riseklix surfaces the current stage, provider failures and guardrails there instead of silently retrying paid calls.</dd>
          </div>
          <div>
            <dt>A model did not return an answer</dt>
            <dd>A genuine “not recommended” result and a failed capture are different states. Riseklix keeps them separate so a provider error is not counted as a visibility miss.</dd>
          </div>
          <div>
            <dt>Company Intelligence is wrong</dt>
            <dd>Correct it at the confirmation checkpoint before continuing. Buyer Situations and benchmark questions are downstream of that company premise.</dd>
          </div>
        </dl>
      </section>

      <section className="support-card">
        <div>
          <div className="eyebrow">HUMAN SUPPORT</div>
          <h2>Something genuinely weird?</h2>
          <p>Send us the project name, what you expected, what happened, and the URL you were on. Screenshots are useful for authentication or provider-specific issues.</p>
        </div>
        <div className="support-actions">
          <a className="primary-link" href="mailto:contact@riseklix.com?subject=Riseklix%20Commercial%20Discovery%20Support">Email support</a>
          <Link className="quiet-button" href="/settings">Account & workspace settings</Link>
        </div>
      </section>

      <footer className="help-footer">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </footer>
    </div>
  )
}
