import Link from 'next/link'

const sections = [
  ['agreement', '1. Agreement to these terms'],
  ['eligibility', '2. Eligibility and authority'],
  ['accounts', '3. Accounts and workspaces'],
  ['service', '4. The service'],
  ['beta', '5. Beta features and product changes'],
  ['inputs', '6. Your inputs and content'],
  ['outputs', '7. AI outputs and research results'],
  ['public-data', '8. Public web research'],
  ['acceptable-use', '9. Acceptable use'],
  ['third-party', '10. Third-party services'],
  ['ip', '11. Intellectual property'],
  ['feedback', '12. Feedback'],
  ['confidentiality', '13. Confidential information'],
  ['fees', '14. Fees and paid features'],
  ['suspension', '15. Suspension and termination'],
  ['warranties', '16. Disclaimers'],
  ['liability', '17. Limitation of liability'],
  ['indemnity', '18. Indemnity'],
  ['law', '19. Governing law and disputes'],
  ['changes', '20. Changes to these terms'],
  ['contact', '21. Contact'],
] as const

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <article className="legal-document legal-document-wide">
        <Link href="/" className="wordmark brand-wordmark" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">TERMS OF SERVICE · EFFECTIVE SEPTEMBER 18, 2026</div>
        <h1>Terms of Service</h1>
        <p className="legal-intro">These Terms of Service (“Terms”) govern access to and use of Riseklix Commercial Discovery and related services provided by Riseklix Media (“Riseklix,” “we,” “us,” or “our”). By creating an account, joining a workspace, or using the service, you agree to these Terms.</p>

        <section className="legal-summary" aria-label="Terms summary">
          <div><span>What the product is</span><p>Commercial Discovery is a research and decision-support platform that studies companies, buyer situations, AI-provider behavior, evidence, and potential visibility gaps.</p></div>
          <div><span>What it is not</span><p>It is not a guarantee of rankings, recommendations, revenue, legal compliance, procurement qualification, or causation.</p></div>
          <div><span>Your responsibility</span><p>You remain responsible for the information you submit, the claims you publish, and business decisions made from product outputs.</p></div>
        </section>

        <nav className="legal-toc" aria-label="Terms of service contents">
          <strong>Contents</strong>
          <div>{sections.map(([id, label]) => <a key={id} href={'#' + id}>{label}</a>)}</div>
        </nav>

        <section id="agreement">
          <h2>1. Agreement to these terms</h2>
          <p>These Terms form a binding agreement between you and Riseklix. If you use the service on behalf of a company or other organization, “you” includes that organization and you represent that you have authority to bind it. If you do not agree to these Terms, do not use the service.</p>
          <p>Additional terms may apply to a particular paid plan, order form, managed service, expert engagement, beta program, integration, or enterprise arrangement. If there is a direct conflict, the signed order form or other specific written agreement controls for that subject.</p>
        </section>

        <section id="eligibility">
          <h2>2. Eligibility and authority</h2>
          <p>You must be at least 18 years old, or the age of legal majority where you live, and legally capable of entering into these Terms. Commercial Discovery is intended primarily for business and professional use.</p>
          <p>If you create or administer a workspace for an organization, you represent that you are authorized to do so. You are responsible for ensuring that your use of the service, including any company information, personal information, connected systems, or implementation materials you provide, is lawful and authorized.</p>
        </section>

        <section id="accounts">
          <h2>3. Accounts and workspaces</h2>
          <p>You must provide accurate account information and keep it reasonably current. You are responsible for safeguarding your authentication methods and for activity performed through your account unless caused by a failure of Riseklix to meet an applicable obligation.</p>
          <p>Workspaces may contain multiple users with different roles. Workspace owners and administrators are responsible for authorizing members, assigning permissions, removing access when appropriate, and determining which companies or projects may be analyzed. An organization administrator may control workspace content and access even if an individual user originally created some of that content.</p>
          <p>You must notify us promptly at <a href="mailto:contact@riseklix.com?subject=Account%20Security">contact@riseklix.com</a> if you reasonably believe an account or workspace has been compromised.</p>
        </section>

        <section id="service">
          <h2>4. The service</h2>
          <p>Commercial Discovery may research public and user-supplied information, generate Company Intelligence, model Buyer Situations, identify competitors, create benchmark questions, observe configured AI systems, capture citations and responses, generate diagnostic findings, produce implementation blueprints, and support later rechecks.</p>
          <p>The service may distinguish observed evidence from inferred explanations, provider failures from genuine non-recommendation results, and implementation delivery from business impact. Those distinctions are part of the product methodology, but they do not make any individual result infallible.</p>
          <p>We may impose reasonable technical, provider, usage, workspace, or rate limits to protect the service, control costs, comply with third-party requirements, and reduce abuse.</p>
        </section>

        <section id="beta">
          <h2>5. Beta features and product changes</h2>
          <p>Commercial Discovery is under active development. Features may be labeled beta, preview, experimental, pilot, or similar. Such features may be incomplete, change materially, produce unexpected results, or be discontinued.</p>
          <p>We may add, modify, suspend, or remove features, providers, workflows, limits, interfaces, and integrations. We will not intentionally make material changes to a paid commitment in a way that conflicts with an applicable signed agreement, but the general service may evolve continuously.</p>
        </section>

        <section id="inputs">
          <h2>6. Your inputs and content</h2>
          <p>“Inputs” means information you or your organization submit to the service, including URLs, project settings, corrections, notes, documents, pasted text, implementation information, and instructions. As between you and Riseklix, you retain your rights in Inputs.</p>
          <p>You grant Riseklix a limited, non-exclusive right to host, copy, transmit, transform, and otherwise process Inputs only as reasonably necessary to provide, secure, support, and maintain the service, comply with law, and exercise our rights under these Terms.</p>
          <p>You represent that you have all rights, permissions, and lawful bases necessary for the Inputs you provide and for the processing you request. Do not submit information you are prohibited from sharing, or sensitive personal information that is unnecessary for the analysis.</p>
        </section>

        <section id="outputs">
          <h2>7. AI outputs and research results</h2>
          <p>“Outputs” includes generated research, Company Intelligence, Buyer Situations, competitor analyses, questions, AI observations, summaries, findings, hypotheses, recommendations, blueprints, and other generated material.</p>
          <p>AI systems can produce inaccurate, incomplete, outdated, inconsistent, or non-unique material. A citation can be malformed or misleading. A provider can fail to respond. A company can change after a source is collected. Different AI systems can answer the same question differently. You must review material outputs before relying on them.</p>
          <p>As between you and Riseklix, and subject to applicable law and third-party rights, you may use Outputs generated for your workspace for your internal business purposes and for implementation on behalf of the analyzed company where you are authorized to do so. Riseklix does not represent that AI-generated material is unique or capable of exclusive ownership.</p>
          <p>Outputs are not legal, tax, financial, investment, medical, procurement, certification, cybersecurity, or other regulated professional advice. Nothing in the service guarantees inclusion, ranking, citation, recommendation, conversion, traffic, revenue, fundraising, sale value, or any other commercial result.</p>
        </section>

        <section id="public-data">
          <h2>8. Public web research</h2>
          <p>Commercial Discovery may use publicly accessible websites and third-party search or research services to understand a business and the market around it. Public availability does not mean information is accurate, current, lawful for every downstream use, or free of third-party rights.</p>
          <p>You are responsible for deciding whether and how to use public-source findings. You may not direct Riseklix to bypass authentication, paywalls, access controls, technical restrictions, or other measures intended to prevent access.</p>
        </section>

        <section id="acceptable-use">
          <h2>9. Acceptable use</h2>
          <p>You may not use Commercial Discovery to:</p>
          <ul>
            <li>violate applicable law, regulation, court order, or third-party rights;</li>
            <li>gain unauthorized access to accounts, systems, data, or networks;</li>
            <li>evade provider, model, search-engine, or platform security controls or rate limits;</li>
            <li>upload malware, destructive code, stolen credentials, or unlawfully obtained data;</li>
            <li>harass, threaten, discriminate against, defraud, impersonate, or deceive others;</li>
            <li>fabricate evidence, citations, provider responses, benchmarks, or research provenance;</li>
            <li>misrepresent AI-generated findings as independently verified facts when they have not been verified;</li>
            <li>use the service to make unlawful or prohibited decisions about individuals based on sensitive or protected characteristics;</li>
            <li>reverse engineer, probe, disrupt, overload, or interfere with the service except where such restriction is prohibited by law; or</li>
            <li>resell or provide direct access to the service except under a plan or written agreement that permits it.</li>
          </ul>
          <p>We may investigate suspected abuse and take proportionate action, including limiting a workflow, suspending access, preserving relevant records, or terminating an account where reasonably necessary.</p>
        </section>

        <section id="third-party">
          <h2>10. Third-party services</h2>
          <p>Riseklix depends on third-party services including hosting, database, authentication, email, search, research, and AI providers. Their availability, model behavior, quotas, data practices, geographic coverage, terms, and interfaces can change independently of Riseklix.</p>
          <p>Your use of a third-party account or connected service may also be governed by that provider&apos;s terms. Riseklix is not responsible for third-party products, websites, or content that we do not control, although we remain responsible for our own obligations under applicable law and agreements.</p>
        </section>

        <section id="ip">
          <h2>11. Intellectual property</h2>
          <p>Riseklix and its licensors retain all rights in the Commercial Discovery software, interface, workflows, product design, code, methods, trademarks, branding, documentation, and other materials we provide, excluding your Inputs and third-party materials.</p>
          <p>Subject to these Terms, we grant you a limited, revocable, non-exclusive, non-transferable right to access and use the service during the applicable subscription or permitted access period for your internal business purposes. These Terms do not grant rights to our trademarks or branding except as expressly authorized in writing.</p>
        </section>

        <section id="feedback">
          <h2>12. Feedback</h2>
          <p>If you voluntarily provide suggestions, feature requests, bug reports, or other feedback about the service, you grant Riseklix permission to use that feedback without restriction or compensation, provided we do not identify you publicly as the source without permission.</p>
        </section>

        <section id="confidentiality">
          <h2>13. Confidential information</h2>
          <p>If either party receives non-public information from the other that is marked confidential or that a reasonable person would understand to be confidential, the receiving party will use reasonable care to protect it and will use it only for the relationship contemplated by these Terms.</p>
          <p>Confidential information does not include information that becomes public without breach, was already lawfully known without confidentiality restriction, is received lawfully from another source without duty of confidentiality, or is independently developed without use of the other party&apos;s confidential information.</p>
          <p>A party may disclose confidential information when required by law or valid legal process, where legally permitted after giving reasonable notice to the other party.</p>
        </section>

        <section id="fees">
          <h2>14. Fees and paid features</h2>
          <p>Some current or future features may require payment. If you purchase a paid plan or service, the applicable checkout page, order form, proposal, or other written commercial terms will state the price, billing period, included usage, taxes, renewal terms, and cancellation rules.</p>
          <p>Unless a written agreement says otherwise, fees paid for completed billing periods or consumed usage are non-refundable to the extent permitted by law. We may change future pricing or plan limits with reasonable notice, but we will not retroactively change fees already due for a completed period.</p>
        </section>

        <section id="suspension">
          <h2>15. Suspension and termination</h2>
          <p>You may stop using the service at any time. Workspace or account deletion may be requested through available product controls or by contacting support where self-service controls are not yet available.</p>
          <p>We may suspend or terminate access if you materially breach these Terms, create a security or legal risk, fail to pay undisputed amounts when due, abuse third-party systems, or use the service in a way that could materially harm users, providers, or the integrity of Commercial Discovery. Where practical and appropriate, we will provide notice and an opportunity to cure before termination.</p>
          <p>Provisions that by their nature should survive termination, including intellectual-property rights, confidentiality, disclaimers, limitations of liability, indemnity, payment obligations, and dispute provisions, will survive.</p>
        </section>

        <section id="warranties">
          <h2>16. Disclaimers</h2>
          <p>To the maximum extent permitted by law, the service and Outputs are provided “as is” and “as available.” Riseklix disclaims implied warranties of merchantability, fitness for a particular purpose, non-infringement, uninterrupted availability, and accuracy to the extent those warranties may lawfully be disclaimed.</p>
          <p>We do not warrant that the service will be error-free, that every provider will be available, that every observation can be reproduced, or that a recommended implementation will cause a particular AI system or customer to behave differently.</p>
          <p>Nothing in these Terms excludes a warranty, right, or remedy that cannot lawfully be excluded.</p>
        </section>

        <section id="liability">
          <h2>17. Limitation of liability</h2>
          <p>To the maximum extent permitted by law, neither Riseklix nor its affiliates, officers, employees, or contractors will be liable for indirect, incidental, special, exemplary, punitive, or consequential damages, or for lost profits, revenues, goodwill, opportunities, or data, arising from or related to the service, even if advised that such damages are possible.</p>
          <p>To the maximum extent permitted by law, Riseklix&apos;s aggregate liability arising out of or relating to the service during any twelve-month period will not exceed the greater of (a) the amounts you paid to Riseklix for the affected service during the twelve months before the event giving rise to liability or (b) US$100.</p>
          <p>The limitations in this section do not apply to liability that cannot be limited under applicable law. If a signed order form or enterprise agreement contains a different liability framework, that agreement controls for the covered service.</p>
        </section>

        <section id="indemnity">
          <h2>18. Indemnity</h2>
          <p>If you use the service on behalf of a business or organization, that organization will, to the extent permitted by law, defend and indemnify Riseklix and its affiliates, officers, employees, and contractors against third-party claims, losses, and reasonable costs arising from the organization&apos;s unlawful Inputs, infringement of third-party rights, material breach of these Terms, or misuse of the service.</p>
          <p>This obligation does not apply to the extent a claim results from Riseklix&apos;s own breach, infringement, negligence, or willful misconduct. We will provide reasonable notice of an indemnified claim and permit the indemnifying party to control the defense, subject to reasonable cooperation and no settlement that imposes an admission or non-monetary obligation on the protected party without consent.</p>
        </section>

        <section id="law">
          <h2>19. Governing law and disputes</h2>
          <p>These Terms are governed by the laws of India, without regard to conflict-of-law principles, except to the extent mandatory law requires otherwise. Courts of competent jurisdiction in India will have jurisdiction over disputes that are not resolved informally, unless a signed agreement between you and Riseklix states a different forum or dispute process.</p>
          <p>Before filing a formal claim, each party agrees to make a reasonable good-faith effort to resolve the dispute by contacting the other party and describing the issue. This informal process does not prevent either party from seeking urgent injunctive or protective relief where appropriate.</p>
          <p>If you are entitled to mandatory consumer protections that cannot be waived by contract, those protections remain unaffected.</p>
        </section>

        <section id="changes">
          <h2>20. Changes to these terms</h2>
          <p>We may update these Terms to reflect changes in the service, law, providers, security practices, or commercial model. The effective date at the top identifies the current version. If a change materially reduces your rights or materially increases your obligations for an existing paid service, we will provide additional notice where required by law or contract.</p>
          <p>Continued use after updated Terms become effective constitutes acceptance where permitted by law. If you do not agree to an update, you must stop using the affected service.</p>
        </section>

        <section id="contact">
          <h2>21. Contact</h2>
          <p>Questions about these Terms, legal notices, or account issues can be sent to:</p>
          <div className="legal-contact-card">
            <strong>Riseklix Media</strong>
            <span>Legal &amp; Support</span>
            <a href="mailto:contact@riseklix.com">contact@riseklix.com</a>
          </div>
        </section>

        <footer><Link href="/privacy">Privacy Policy</Link><Link href="/login">Back to sign in</Link></footer>
      </article>
    </main>
  )
}
