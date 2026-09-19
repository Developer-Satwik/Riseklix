import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8')
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error('Methodology invariant failed: ' + label)
  }
}

function forbidText(source, needle, label) {
  if (source.includes(needle)) {
    throw new Error('Methodology invariant failed: ' + label)
  }
}

const report = read('app/(app)/projects/[id]/report/page.tsx')
const why = read('supabase/functions/why-evaluator/index.ts')
const observation = read('supabase/functions/all-observation-runner/index.ts')
const recheckPage = read('app/(app)/projects/[id]/recheck/page.tsx')
const recheckActions = read('app/(app)/projects/[id]/recheck/actions.ts')
const watchdog = read('supabase/functions/autopilot-watchdog/index.ts')
const watchdogMigration = read('supabase/migrations/0025_schedule_autopilot_watchdog.sql')

requireText(
  report,
  "run.run_status === 'captured' && usableProviderSet.has(run.provider)",
  'Report aggregates must exclude providers outside the usable benchmark set.',
)
requireText(
  why,
  'rawCapturedRuns.filter((run) => usableProviderSet.has(run.provider))',
  'WHY evidence must exclude providers outside the usable benchmark set.',
)
requireText(
  observation,
  'const MIN_USABLE_PROVIDERS = 3',
  'Benchmark completion must retain the three-provider minimum.',
)
requireText(
  observation,
  'usable_providers: usableSurfaces.map((surface) => surface.provider)',
  'Terminal benchmarks must freeze the usable provider set.',
)
requireText(
  observation,
  "['observation_budget_exceeded', 'ai_budget_exceeded']",
  'Internal budget limits must stay distinct from provider failures.',
)
requireText(
  report,
  "value === 'urgent' || value === 'critical'",
  'Report priority ranking must understand the canonical urgent severity.',
)
requireText(
  report,
  "value === 'opportunity' || value === 'high'",
  'Report priority ranking must understand the canonical opportunity severity.',
)
requireText(
  recheckActions,
  'usable_providers: _baselineUsableProviders',
  'Rechecks must not inherit the baseline usable-provider outcome.',
)
requireText(
  recheckActions,
  'automatic_retry_blocked: _automaticRetryBlocked',
  'Rechecks must not inherit provider runtime failure state.',
)
forbidText(
  recheckPage,
  'runOpenAIObservationBatch',
  'Recheck must not require a per-provider OpenAI run button.',
)
forbidText(
  recheckPage,
  'runProviderObservationBatch',
  'Recheck must not require per-provider run buttons.',
)
requireText(
  watchdog,
  "verify_autopilot_watchdog_token",
  'The durable watchdog must verify its database-owned token.',
)
requireText(
  watchdogMigration,
  "'riseklix-autopilot-watchdog'",
  'The durable watchdog cron must remain declared in migrations.',
)

console.log('Methodology invariants passed.')
