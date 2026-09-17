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
- Company Profile approval boundary
- Data-backed Overview / Buyer Situations / Why / Fixes / Recheck screens
- Versioned benchmark/evidence architecture

Next backend milestone: company research worker — crawl first-party site + outside-in evidence, preserve sources, produce a draft Company Intelligence Profile, and route low-confidence claims to review before Buyer Intent generation.

This directory is intentionally isolated from the existing Riseklix marketing site.
