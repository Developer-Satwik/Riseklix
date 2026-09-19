import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <Link href="/" className="wordmark brand-wordmark" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="landing-nav-actions">
          <span>Commercial Discovery</span>
          <Link href="/login" className="quiet-button">Sign in</Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="eyebrow">AI COMMERCIAL DISCOVERY</div>
        <h1>See where AI should be considering your business — but isn’t.</h1>
        <p>
          Riseklix researches your company, models the buying situations you legitimately qualify for,
          observes how AI systems respond, and turns justified gaps into work your team can actually execute.
        </p>
        <form action="/projects/new" method="get" className="domain-capture">
          <input name="domain" type="text" placeholder="yourcompany.com" aria-label="Company website" required />
          <button type="submit">Investigate my company</button>
        </form>
        <div className="landing-proof">
          <span>Company intelligence</span>
          <span>Buyer situations</span>
          <span>Unaided + aided controls</span>
          <span>Evidence-backed WHY</span>
          <span>Executable fixes</span>
        </div>

        <div className="landing-product-glimpse" aria-label="Example Riseklix finding">
          <div className="glimpse-rail">
            <span>01 Company</span><span>02 Situations</span><span>03 Observe</span><span className="active">04 Why</span><span>05 Fix</span>
          </div>
          <div className="glimpse-card">
            <div className="eyebrow">EXAMPLE FINDING</div>
            <h2>AI understands the capability when you are named. It rarely recommends you when the buyer asks unaided.</h2>
            <div className="glimpse-evidence">
              <div><small>Observed</small><strong>1 / 4</strong><span>unaided surfaces retrieved the company</span></div>
              <div><small>Aided control</small><strong>4 / 4</strong><span>recognized the relevant capability</span></div>
              <div><small>Decision</small><strong>Investigate</strong><span>possible association/evidence gap</span></div>
            </div>
            <p>Possible explanation — not proven cause. Riseklix keeps the observation separate from the interpretation.</p>
          </div>
        </div>
      </section>

      <section className="landing-explainer">
        <div className="eyebrow">THE QUESTION WE START WITH</div>
        <blockquote>“In which commercial situations could this company legitimately deserve consideration?”</blockquote>
        <p>We model the buying decision first. Prompt wording, competitors, observations and implementation come afterward.</p>
      </section>

      <section className="landing-workflow">
        <header>
          <div className="eyebrow">ONE GUIDED WORKFLOW</div>
          <h2>Complex research underneath. Five human questions on top.</h2>
          <p>The customer should make decisions, not operate an analytics cockpit.</p>
        </header>
        <div className="landing-workflow-grid">
          <article><span>01</span><h3>What are we?</h3><p>Research and approve the company premise.</p></article>
          <article><span>02</span><h3>Where should we compete?</h3><p>Approve the Buyer Situations that are commercially legitimate.</p></article>
          <article><span>03</span><h3>What happened?</h3><p>Observe declared AI surfaces without mixing misses and failed captures.</p></article>
          <article><span>04</span><h3>Why might it be happening?</h3><p>Compare controls, competitors and evidence without pretending causality.</p></article>
          <article><span>05</span><h3>What deserves action?</h3><p>Turn only justified gaps into scoped work and recheck later.</p></article>
        </div>
      </section>

      <section className="landing-trust">
        <div className="eyebrow">A DIFFERENT PRODUCT POSTURE</div>
        <h2>Riseklix does not manufacture certainty.</h2>
        <p>Not every miss deserves a fix. Not every before/after change proves causality. “Monitor”, “investigate” and “no change justified” are first-class outcomes.</p>
        <Link href="/login" className="primary-link">Open the workspace →</Link>
      </section>
    </main>
  )
}
