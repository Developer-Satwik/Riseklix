# Riseklix Commercial Discovery V1

Fresh product workspace for the Riseklix Commercial Discovery application.

## Product flow

1. Company Intelligence
2. Buyer Intent modelling
3. Intent-specific competitor discovery
4. Unaided + aided AI observation
5. Evidence-backed WHY diagnosis
6. Executable implementation blueprint
7. DIY / expert / managed execution routing
8. Verified delivery + fixed-panel recheck

## Stack

- Next.js 16 + React 19 + TypeScript
- Supabase Auth + Postgres + Row Level Security
- Server-first App Router data access
- Supabase Edge Functions for authenticated research jobs
- Core objects preserve company profiles, buyer intents, competitor relationships, prompt versions, observations, evidence, findings, blueprints and rechecks.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` using the publishable key for the connected Supabase project. Never commit a secret/service-role key.

For SSR email confirmation, set the Supabase **Confirm signup** template URL to:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

Then set the Auth Site URL / allowed redirects to the local and deployed application URLs.

## Current milestone

Implemented:
- Production-shaped database schema + RLS
- Workspace and project isolation
- Password auth shell
- Project creation persisted to Supabase
- Versioned Company Intelligence approval boundary
- Authenticated first-party research job with bounded homepage capture + evidence hashing
- Persistent research jobs and human-review queue
- Editable Company Intelligence review + approval
- Buyer Situation candidate review, approve/reject flow and internal QA entry path
- Data-backed Overview / Buyer Situations / Why / Fixes / Recheck screens
- Versioned benchmark/evidence architecture
- Dependency security gate, TypeScript, ESLint and production-build CI

## Next milestones

1. Expand Company Intelligence from homepage seed to controlled first-party crawl + outside-in evidence.
2. Add the differentiated Buyer Intent Suggestor against the approved Company Intelligence Profile.
3. Add intent-specific competitor discovery with controlled L0→L5 constraint relaxation.
4. Generate prompt expressions only after intent approval.
5. Connect declared live model-observation providers and preserve raw answers/citations.
6. Build the evidence-calibrated WHY evaluator and Blueprint generator.

This directory is intentionally isolated from the existing Riseklix marketing site.
