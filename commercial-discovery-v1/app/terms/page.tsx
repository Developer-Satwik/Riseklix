import Link from 'next/link'

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <article className="legal-document">
        <Link href="/" className="wordmark brand-wordmark" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">TERMS OF SERVICE · SEPTEMBER 18, 2026</div>
        <h1>Terms of Service</h1>
        <p className="legal-intro">These terms govern access to the Riseklix Commercial Discovery product. They are written for the current beta product and may be updated as billing, marketplace and managed-service features launch.</p>

        <h2>1. Accounts and workspaces</h2>
        <p>You are responsible for the accuracy of account information, for activity under your account, and for keeping authentication credentials secure. Organization owners are responsible for the members and projects they authorize inside their workspace.</p>

        <h2>2. What Riseklix provides</h2>
        <p>Riseklix researches public and user-supplied information, models commercial buying situations, observes configured AI systems, generates diagnostic findings and may generate implementation guidance. AI outputs and third-party model responses can be incomplete, stale, inconsistent or incorrect.</p>

        <h2>3. Your responsibility for claims and implementation</h2>
        <p>You must verify business claims, certifications, legal statements, technical specifications and other material facts before publishing or acting on them. Riseklix findings are decision-support outputs, not procurement certification, legal advice, financial advice or a guarantee of placement in any AI product.</p>

        <h2>4. Authorized use of company information</h2>
        <p>You may analyze companies using public information. If you upload private materials, connect systems, or authorize implementation work, you represent that you have the right to provide and use that information for the requested purpose.</p>

        <h2>5. Acceptable use</h2>
        <p>You may not use the service to abuse third-party systems, evade provider limits, compromise accounts, scrape unlawfully, interfere with service integrity, or generate deceptive evidence. We may suspend activity that threatens users, providers, infrastructure or the integrity of research results.</p>

        <h2>6. Third-party systems</h2>
        <p>Riseklix depends on external services including hosting, authentication, search and AI providers. Their availability, model behavior, quotas and product interfaces can change independently of Riseklix.</p>

        <h2>7. Beta availability and changes</h2>
        <p>The current product is under active development. Features, limits and workflows may change. We may introduce paid plans, usage limits, additional terms or marketplace terms before those features become generally available.</p>

        <h2>8. No guaranteed outcome</h2>
        <p>Riseklix does not guarantee rankings, citations, recommendations, traffic, revenue or other business outcomes. Before-and-after changes in model behavior do not by themselves prove that an implementation caused the change.</p>

        <h2>9. Contact</h2>
        <p>Questions about these terms can be sent through the support contact published in the Riseklix application or website.</p>

        <footer><Link href="/privacy">Privacy Policy</Link><Link href="/login">Back to sign in</Link></footer>
      </article>
    </main>
  )
}
