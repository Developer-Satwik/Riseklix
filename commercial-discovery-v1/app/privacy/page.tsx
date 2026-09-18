import Link from 'next/link'

const sections = [
  ['scope', '1. Scope and who we are'],
  ['data', '2. Information we process'],
  ['sources', '3. Where information comes from'],
  ['use', '4. How and why we use information'],
  ['ai', '5. AI, research and automated processing'],
  ['sharing', '6. How information is shared'],
  ['cookies', '7. Cookies and similar technologies'],
  ['retention', '8. Retention and deletion'],
  ['security', '9. Security'],
  ['transfers', '10. International processing'],
  ['rights', '11. Your privacy rights'],
  ['regional', '12. Regional disclosures'],
  ['business', '13. Business-customer data'],
  ['children', '14. Children'],
  ['changes', '15. Changes to this policy'],
  ['contact', '16. Contact us'],
] as const

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <article className="legal-document legal-document-wide">
        <Link href="/" className="wordmark brand-wordmark" aria-label="Riseklix"><span className="brand-mark" aria-hidden="true" /><strong>RISEKLIX</strong></Link>
        <div className="eyebrow">PRIVACY POLICY · EFFECTIVE SEPTEMBER 18, 2026</div>
        <h1>Privacy Policy</h1>
        <p className="legal-intro">This Privacy Policy explains how Riseklix Media (“Riseklix,” “we,” “us,” or “our”) handles personal information when you use Riseklix Commercial Discovery, visit our product pages, create an account, run research, contact support, or otherwise interact with the service.</p>

        <section className="legal-summary" aria-label="Privacy summary">
          <div><span>What we collect</span><p>Account and workspace information, project inputs, product-generated research, authentication data, support messages, and limited technical records needed to operate the service.</p></div>
          <div><span>What we do with it</span><p>Provide the product, secure accounts, run requested research, generate analyses, troubleshoot issues, enforce limits, and improve reliability.</p></div>
          <div><span>What we do not do</span><p>We do not sell personal information or use customer project content for cross-context behavioral advertising. We do not ask users to submit unnecessary sensitive personal information.</p></div>
        </section>

        <nav className="legal-toc" aria-label="Privacy policy contents">
          <strong>Contents</strong>
          <div>{sections.map(([id, label]) => <a key={id} href={'#' + id}>{label}</a>)}</div>
        </nav>

        <section id="scope">
          <h2>1. Scope and who we are</h2>
          <p>This policy applies to the Riseklix Commercial Discovery application and related support interactions. It does not govern third-party websites, AI providers, identity providers, or other services that have their own privacy terms.</p>
          <p>Riseklix is designed primarily for business and professional use. Depending on the context and applicable law, Riseklix may act as a controller, business, or data fiduciary for account and product-operations data. Where a business customer provides personal information for us to process on its behalf, Riseklix may instead act as a processor, service provider, or data processor for that customer.</p>
        </section>

        <section id="data">
          <h2>2. Information we process</h2>

          <h3>Account and workspace information</h3>
          <p>We may process your name, business email address, profile image, organization name, workspace membership, role, authentication identifiers, and account status. If you sign in with Google or Microsoft, we may receive basic profile information permitted by that provider, such as your verified email address, name, and profile image.</p>

          <h3>Project inputs and customer content</h3>
          <p>When you create or edit a project, we process the company URL, market or geography, project settings, approved Company Intelligence, corrections, notes, uploaded or pasted information, and other instructions you provide. You control what you submit and should avoid including personal or confidential information that is not necessary for the analysis.</p>

          <h3>Research and product-generated information</h3>
          <p>The service creates and stores research evidence, source references, Company Intelligence, Buyer Situations, competitor sets, benchmark questions, AI-provider observations, citations, diagnostic findings, hypotheses, blueprints, recheck results, workflow states, provider statuses, and audit records. Some of this information may relate to identifiable business contacts or people when that information appears in public business sources or is included in customer content.</p>

          <h3>Support and communications</h3>
          <p>If you contact us, we process the information you send, such as your email address, message, screenshots, project references, and troubleshooting details. We use this information to respond, investigate issues, and maintain support records.</p>

          <h3>Technical, security, and usage information</h3>
          <p>We and our infrastructure providers may process IP address, browser or device information, request metadata, authentication events, timestamps, error information, security signals, rate-limit events, and similar operational data necessary to deliver, protect, diagnose, and maintain the service. We do not currently use the Commercial Discovery application for third-party behavioral advertising.</p>
        </section>

        <section id="sources">
          <h2>3. Where information comes from</h2>
          <p>We obtain information directly from you, from members or administrators of your organization, from identity providers you choose to use, from publicly accessible web sources used for company research, from AI and search providers used to perform a requested workflow, and from our infrastructure when you interact with the service.</p>
          <p>Public-source research may include company websites, public business profiles, documentation, publications, search results, news or industry pages, and other sources available on the open web. The presence of information in a public source does not mean Riseklix has verified that information as accurate.</p>
        </section>

        <section id="use">
          <h2>4. How and why we use information</h2>
          <p>We use personal information only for purposes connected to operating, securing, supporting, and improving Commercial Discovery, including to:</p>
          <ul>
            <li>create and administer accounts, workspaces, roles, and sessions;</li>
            <li>run the company research, AI observations, diagnostics, blueprints, and rechecks you request;</li>
            <li>preserve project history and benchmark state so results remain inspectable over time;</li>
            <li>provide customer support and investigate technical or provider failures;</li>
            <li>protect accounts, detect abuse, enforce usage limits, and maintain auditability;</li>
            <li>debug, monitor, and improve the reliability and usability of the service;</li>
            <li>communicate service, security, policy, or administrative updates; and</li>
            <li>comply with legal obligations, protect legal rights, and resolve disputes.</li>
          </ul>

          <h3>Lawful bases where the GDPR or UK GDPR applies</h3>
          <p>Depending on the processing activity, we rely on performance of a contract or steps requested before entering a contract, our legitimate interests in operating and securing a business service, compliance with legal obligations, and consent where consent is required. Our legitimate interests may include preventing fraud and abuse, maintaining service reliability, responding to support requests, and improving the product in ways users would reasonably expect. Where we rely on consent, you may withdraw it as described below.</p>
        </section>

        <section id="ai">
          <h2>5. AI, research and automated processing</h2>
          <p>Commercial Discovery uses third-party AI systems and search or research services to perform parts of requested analyses. Depending on the workflow, relevant prompts, buyer questions, company context, public-source excerpts, and other limited project information may be sent to enabled providers. Providers may include OpenAI, Google, Anthropic, Perplexity, or other services we add or substitute as the product evolves.</p>
          <p>We aim to limit information sent to a provider to what is reasonably necessary for the requested operation. Provider processing is also governed by the provider&apos;s own terms, data controls, and retention practices. For example, some business API providers state that API inputs and outputs are not used for model training by default, but their retention and abuse-monitoring practices can vary by service and configuration.</p>
          <p>Riseklix uses automation to generate company research, benchmark questions, observations, diagnoses, and recommended actions. The product is not designed to make solely automated decisions about individuals that produce legal or similarly significant effects. Its outputs are decision-support materials and should be reviewed by a person before material business action is taken.</p>
        </section>

        <section id="sharing">
          <h2>6. How information is shared</h2>
          <p>We do not sell personal information. We may disclose information to the following categories of recipients when necessary to operate the service:</p>
          <ul>
            <li><strong>Infrastructure and database providers</strong> that host application, database, authentication, storage, edge-compute, or delivery services, including providers such as Supabase and Netlify.</li>
            <li><strong>Identity providers</strong> such as Google or Microsoft when you choose social sign-in.</li>
            <li><strong>AI, search, and research providers</strong> used to execute the workflows you request.</li>
            <li><strong>Professional advisers and service providers</strong> where reasonably necessary for security, legal, accounting, support, or operational purposes.</li>
            <li><strong>Authorities or other parties</strong> when required by law, legal process, or to protect the rights, safety, security, or integrity of users, Riseklix, or others.</li>
            <li><strong>Transaction counterparties</strong> in connection with a merger, financing, acquisition, restructuring, sale of assets, or similar corporate transaction, subject to appropriate confidentiality protections where required.</li>
          </ul>
          <p>Workspace administrators and authorized members of your organization may access project and account information according to their role. If your organization controls your workspace, its administrator may manage access even if your individual account was originally created by you.</p>
        </section>

        <section id="cookies">
          <h2>7. Cookies and similar technologies</h2>
          <p>Commercial Discovery uses cookies and similar browser storage that are necessary for authentication, session continuity, security, and core product functionality. These technologies may store session identifiers and security state so you can remain signed in and use the application safely.</p>
          <p>We do not currently use the application for third-party cross-site behavioral advertising. If we introduce non-essential analytics, advertising, or similar technologies that require notice or consent, we will update this policy and provide controls required by applicable law.</p>
        </section>

        <section id="retention">
          <h2>8. Retention and deletion</h2>
          <p>We retain information for as long as reasonably necessary for the purposes described in this policy. Retention depends on the type of information, the reason we hold it, workspace status, contractual needs, security requirements, dispute or audit needs, backup cycles, and applicable law.</p>
          <p>Account, workspace, project, benchmark, and recheck information may be retained while your account or workspace remains active because longitudinal comparison is a core part of the product. Security and audit records may be retained for a period appropriate to abuse prevention and incident investigation. Support records may be retained while an issue is open and for a reasonable period afterward.</p>
          <p>You may request deletion of eligible personal information by contacting us. Some information may be retained where necessary to comply with law, establish or defend legal claims, prevent fraud or abuse, preserve a record of a completed transaction, or maintain security and backup integrity. Information processed by third-party providers may also be subject to their own retention periods.</p>
        </section>

        <section id="security">
          <h2>9. Security</h2>
          <p>We use technical and organizational safeguards intended to reduce the risk of unauthorized access, alteration, disclosure, or destruction. Current controls include authenticated workspaces, role-based access patterns, database row-level access controls, server-side handling of provider credentials, CAPTCHA support, usage and rate limits, audit records, and encrypted transport provided by our hosting and infrastructure stack.</p>
          <p>No internet service can guarantee absolute security. You are responsible for protecting your authentication methods, using appropriate access controls inside your organization, and promptly notifying us if you believe an account or workspace has been compromised.</p>
        </section>

        <section id="transfers">
          <h2>10. International processing</h2>
          <p>Riseklix and its service providers may process information in countries other than the country where you are located. Those countries may have different data-protection laws. Where applicable law requires safeguards for an international transfer, we use or rely on legally recognized mechanisms made available through our service-provider arrangements and take additional measures where appropriate.</p>
        </section>

        <section id="rights">
          <h2>11. Your privacy rights</h2>
          <p>Depending on where you live and which law applies, you may have rights to request access to personal information, correction of inaccurate information, deletion, restriction of processing, portability, withdrawal of consent, or objection to certain processing. You may also have a right to complain to a data-protection or privacy regulator.</p>
          <p>To exercise a privacy right, email <a href="mailto:contact@riseklix.com?subject=Privacy%20Request">contact@riseklix.com</a> with the subject “Privacy Request.” We may need to verify your identity and your relationship to the relevant workspace before completing a request. If your information is controlled by a business customer and Riseklix processes it only on that customer&apos;s behalf, we may direct your request to that customer or assist the customer as required.</p>
          <p>We will not discriminate against you for exercising a privacy right where applicable law prohibits such discrimination. Some rights are subject to exceptions and may not apply in every circumstance.</p>
        </section>

        <section id="regional">
          <h2>12. Regional disclosures</h2>

          <h3>India</h3>
          <p>Where India&apos;s Digital Personal Data Protection Act, 2023 and applicable rules apply, Riseklix will process personal data for lawful purposes and provide notices and mechanisms required by applicable provisions as they come into force. Depending on the circumstances, individuals may have rights concerning access to information about processing, correction, completion, erasure, grievance redressal, and nomination. Consent, where relied on, may be withdrawn through the contact method above, subject to processing that remains permitted or required by law.</p>

          <h3>European Economic Area and United Kingdom</h3>
          <p>Where the GDPR or UK GDPR applies, you may have rights of access, rectification, erasure, restriction, portability, objection, and withdrawal of consent, as applicable to the relevant processing. You may also lodge a complaint with the supervisory authority in the country where you live, work, or believe an infringement occurred.</p>

          <h3>California and other U.S. states</h3>
          <p>Where an applicable U.S. state privacy law covers our processing, residents may have rights to know or access, correct, delete, obtain a portable copy of certain information, and opt out of certain uses defined by law. Riseklix does not currently sell personal information or share personal information for cross-context behavioral advertising as those concepts are generally used under California privacy law. Because statutory thresholds and exemptions differ, a particular state law may not apply to every user or processing activity.</p>
        </section>

        <section id="business">
          <h2>13. Business-customer data</h2>
          <p>If your employer, client, or other organization provides you access to Commercial Discovery, that organization may be the party that determines why and how certain workspace information is processed. In those circumstances, you should direct questions about the organization&apos;s own processing decisions to that organization.</p>
          <p>Business customers are responsible for having an appropriate legal basis and authority for personal information they submit to Riseklix. Customers should not use the service to upload special-category, highly sensitive, regulated, or confidential personal data unless it is necessary, authorized, and covered by appropriate contractual and legal safeguards.</p>
        </section>

        <section id="children">
          <h2>14. Children</h2>
          <p>Commercial Discovery is a business product and is not directed to children. You must be at least 18 years old, or the age of legal majority where you live, to create an account unless use is specifically authorized through an organization and permitted by applicable law. If we learn that personal information from a child was submitted in a manner prohibited by law, we will take appropriate steps to delete or restrict it.</p>
        </section>

        <section id="changes">
          <h2>15. Changes to this policy</h2>
          <p>We may update this policy as the product, providers, legal requirements, or business model change. The effective date at the top shows when this version became effective. If a change materially affects how we use personal information, we will provide additional notice where required, such as through the product, by email, or before a new processing purpose begins.</p>
        </section>

        <section id="contact">
          <h2>16. Contact us</h2>
          <p>For privacy questions, rights requests, or concerns about how Riseklix handles information, contact:</p>
          <div className="legal-contact-card">
            <strong>Riseklix Media</strong>
            <span>Privacy &amp; Support</span>
            <a href="mailto:contact@riseklix.com">contact@riseklix.com</a>
          </div>
          <p>If you are contacting us about a workspace administered by your employer or client, include the organization name and enough information for us to identify the relevant account without sending unnecessary sensitive information.</p>
        </section>

        <footer><Link href="/terms">Terms of Service</Link><Link href="/login">Back to sign in</Link></footer>
      </article>
    </main>
  )
}
