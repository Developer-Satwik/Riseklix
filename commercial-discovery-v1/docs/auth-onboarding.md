# Riseklix authentication and onboarding

## Product flow

New users authenticate first, then complete one short workspace setup:

1. Continue with Google, Microsoft or email/password.
2. Confirm name and organization name on `/onboarding`.
3. Riseklix creates the organization workspace and owner membership transactionally.
4. The user lands on `/projects/new`.
5. Company analysis is separate from the organization using Riseklix.

Existing users with a workspace are backfilled as already onboarded.

## OAuth providers

Supabase remains the auth broker.

### Google

Enable Google under Supabase Dashboard -> Authentication -> Providers.

Create a Google OAuth client and use the Supabase callback URL as the Google Authorized redirect URI:

`https://xxewilxkoqdeqostcxtq.supabase.co/auth/v1/callback`

Add both local and production application URLs to Supabase Authentication -> URL Configuration -> Redirect URLs, including:

- `http://localhost:3000/auth/callback`
- `https://<production-domain>/auth/callback`

### Microsoft

Enable Azure (Microsoft) under Supabase Authentication -> Providers.

In Microsoft Entra, use the same Supabase callback pattern:

`https://xxewilxkoqdeqostcxtq.supabase.co/auth/v1/callback`

The application uses Supabase provider id `azure` and requests the `email` scope.

## Cloudflare Turnstile

The login and password-reset forms render Turnstile when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is configured.

For production enforcement:

1. Create a Turnstile widget in Cloudflare in Managed mode.
2. Put the public site key in the Next.js environment as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
3. In Supabase Dashboard -> Authentication -> Bot and Abuse Protection / CAPTCHA, enable Turnstile and add the Turnstile secret key.
4. Do not expose the Turnstile secret in `NEXT_PUBLIC_*` variables or commit it to GitHub.

Email/password actions forward the Turnstile token to Supabase as `captchaToken`.

## Email and SMTP

Email/password remains available during V1. Before public launch, configure custom SMTP in Supabase Authentication settings so confirmation and recovery emails are deliverable outside the project-team allowlist and use a branded sender.

After SMTP is configured, email signup can be migrated to a six-digit OTP flow without changing the onboarding data model.

## Password recovery

`/forgot-password` starts recovery and redirects authenticated recovery sessions through:

`/auth/callback?next=/update-password`

`/update-password` requires an authenticated recovery session and updates the Supabase Auth password.

## Account data

`profiles` stores the user display name, optional avatar URL and `onboarding_completed_at`.

`workspaces.name` is the organization name entered during onboarding.

The company being analyzed is always a separate `projects` record. An agency organization can therefore analyze many unrelated client companies.

## Security posture

- Workspace access remains protected by RLS.
- OAuth provider secrets stay in Supabase Auth configuration.
- AI provider secrets stay in Supabase Edge Function secrets.
- Turnstile is attached to email auth and recovery.
- Authentication rate limits are controlled in Supabase Auth.
- Project and AI-call spend guardrails remain separate from authentication limits.
