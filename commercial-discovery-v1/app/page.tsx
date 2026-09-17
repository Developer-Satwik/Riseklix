import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <div className="wordmark"><span>R</span> RISEKLIX</div>
        <Link href="/login" className="quiet-button">Sign in</Link>
      </header>

      <section className="landing-hero">
        <div className="eyebrow">AI COMMERCIAL DISCOVERY</div>
        <h1>See where AI should be recommending your business — but isn’t.</h1>
        <p>
          Riseklix researches your company, identifies the buying situations you legitimately qualify for,
          tests how AI responds, and turns evidence-backed gaps into work your team can actually execute.
        </p>
        <form action="/projects/new" method="get" className="domain-capture">
          <input name="domain" type="text" placeholder="yourcompany.com" aria-label="Company website" required />
          <button type="submit">Investigate my company</button>
        </form>
        <div className="landing-proof">
          <span>Company intelligence</span>
          <span>Buyer situations</span>
          <span>Unaided + aided testing</span>
          <span>WHY diagnosis</span>
          <span>Executable fixes</span>
        </div>
      </section>

      <section className="landing-explainer">
        <div className="eyebrow">THE QUESTION WE START WITH</div>
        <blockquote>“In which commercial situations could this company legitimately deserve consideration?”</blockquote>
        <p>We model the buying situation first. Prompt wording, competitors, AI observations and recommendations come after.</p>
      </section>
    </main>
  )
}
