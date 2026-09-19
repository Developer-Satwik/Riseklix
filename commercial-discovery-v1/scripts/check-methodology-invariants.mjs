import { readFileSync } from 'node:fs'
import ts from 'typescript'

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
const promptGenerator = read('supabase/functions/prompt-expression-generator/index.ts')
const autopilot = read('supabase/functions/auto-analysis-runner/index.ts')
const testActions = read('app/(app)/projects/[id]/test/actions.ts')
const recheckActionsSource = read('app/(app)/projects/[id]/recheck/actions.ts')
const promptReviewActions = read('app/(app)/projects/[id]/buyer-situations/prompt-actions.ts')
const appPromptEligibility = read('lib/prompt-eligibility.ts')
const edgePromptEligibility = read('supabase/functions/_shared/prompt-eligibility.ts')

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

requireText(
  watchdogMigration,
  'where project_url is not null',
  'Fresh environments must be able to apply the watchdog schedule before project_url is configured.',
)
forbidText(
  watchdogMigration,
  "raise exception 'Vault secret project_url",
  'Watchdog migrations must not hard-fail fresh environments that have not configured project_url yet.',
)



if (appPromptEligibility !== edgePromptEligibility) {
  throw new Error('Methodology invariant failed: app and edge prompt-eligibility rules must stay identical.')
}
requireText(
  promptGenerator,
  "isUnaidedRetrievalEligible(item.prompt_text)",
  'Generated unaided questions must pass retrieval-eligibility validation before storage.',
)
requireText(
  promptGenerator,
  "criteria-only question",
  'Prompt generation instructions must explicitly reject criteria-only unaided questions.',
)
requireText(
  autopilot,
  "prompt.mode !== 'unaided' || isUnaidedRetrievalEligible(prompt.prompt_text)",
  'Autopilot must exclude informational unaided prompts before building the benchmark.',
)
requireText(
  testActions,
  "expression.mode !== 'unaided' || isUnaidedRetrievalEligible(expression.prompt_text)",
  'Manual test baseline creation must exclude informational unaided prompts.',
)
requireText(
  recheckActionsSource,
  "expression.mode !== 'unaided' || isUnaidedRetrievalEligible(expression.prompt_text)",
  'Legacy baseline creation must exclude informational unaided prompts.',
)
requireText(
  promptReviewActions,
  "status === 'approved' && prompt.mode === 'unaided' && !isUnaidedRetrievalEligible(prompt.prompt_text)",
  'Manual prompt approval must reject informational unaided questions before they can enter a future benchmark.',
)
requireText(
  appPromptEligibility,
  "informational_or_criteria_only",
  'Prompt eligibility must distinguish criteria/advice questions from retrieval questions.',
)

const transpiledPromptEligibility = ts.transpileModule(appPromptEligibility, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const promptEligibilityModule = { exports: {} }
new Function('module', 'exports', transpiledPromptEligibility)(
  promptEligibilityModule,
  promptEligibilityModule.exports,
)
const { isUnaidedRetrievalEligible } = promptEligibilityModule.exports

const promptEligibilityCases = [
  {
    prompt: "What should I verify about a vendor's SMS availability, setup, limits and reply handling before adding it to an ecommerce program?",
    expected: false,
    label: 'criteria-only vendor verification must not enter retrieval denominators',
  },
  {
    prompt: 'How should I compare shared inbox vendors before choosing one?',
    expected: false,
    label: 'evaluation-criteria advice must not count as brand discovery',
  },
  {
    prompt: 'Which ecommerce messaging platforms can run automated journeys with production-ready SMS while keeping replies connected across WhatsApp, Instagram and Messenger?',
    expected: true,
    label: 'provider shortlist question must remain retrieval eligible',
  },
  {
    prompt: 'What software should a US ecommerce brand use for automated reorder reminders?',
    expected: true,
    label: 'natural what-software selection question must remain eligible',
  },
  {
    prompt: 'Kaunse shared inbox tools WhatsApp, Instagram aur Messenger ko ek jagah manage karte hain?',
    expected: true,
    label: 'Hinglish provider-discovery question must remain eligible',
  },
  {
    prompt: 'कौन से प्लेटफ़ॉर्म WhatsApp और Instagram संदेशों को एक shared inbox में संभाल सकते हैं?',
    expected: true,
    label: 'Hindi provider-discovery question must remain eligible',
  },
]

for (const testCase of promptEligibilityCases) {
  const actual = isUnaidedRetrievalEligible(testCase.prompt)
  if (actual !== testCase.expected) {
    throw new Error('Methodology invariant failed: ' + testCase.label)
  }
}

const trustedWorkerFunctions = [
  'auto-analysis-runner',
  'intent-suggestor',
  'competitor-discovery',
  'prompt-expression-generator',
  'all-observation-runner',
  'openai-observation-runner',
  'provider-observation-runner',
  'why-evaluator',
].map((name) => ({
  name,
  source: read('supabase/functions/' + name + '/index.ts'),
}))

for (const worker of trustedWorkerFunctions) {
  requireText(
    worker.source,
    "withSupabase({ auth: ['user','secret'] }",
    worker.name + ' must accept either an authenticated user or trusted secret worker.',
  )
  requireText(
    worker.source,
    "const db = ctx.authMode === 'user' ? ctx.supabase : ctx.supabaseAdmin",
    worker.name + ' must keep user calls RLS-scoped and secret-worker calls admin-scoped.',
  )
  forbidText(
    worker.source,
    "const db = ctx.authMode === 'user' ? db : ctx.supabaseAdmin",
    worker.name + ' must never self-reference the database client selector.',
  )
}


const autoRunner = trustedWorkerFunctions.find((item) => item.name === 'auto-analysis-runner').source
requireText(
  autoRunner,
  "throw new Error('Autopilot state update failed: ' + error.message)",
  'Autopilot state writes must fail loudly instead of returning progress that was never persisted.',
)
requireText(
  autoRunner,
  "const metadata = Object.keys(extra).length",
  'Autopilot response-only release details must be persisted inside metadata.',
)
forbidText(
  autoRunner,
  "updateRun({ stage, progress, lease_until: null, ...extra })",
  'Autopilot release details must never be spread into database columns.',
)


const manualIntentActions = read('app/(app)/projects/[id]/buyer-situations/actions.ts')
const manualPromptActions = read('app/(app)/projects/[id]/buyer-situations/prompt-actions.ts')
const manualWhyActions = read('app/(app)/projects/[id]/why/actions.ts')

requireText(
  autoRunner,
  "review_source: 'autopilot'",
  'Autopilot decisions must record that the system, not a human reviewer, accepted them.',
)
requireText(
  autoRunner,
  "approved_by: null",
  'Autopilot Buyer Situation and question acceptance must not impersonate a human approver.',
)
requireText(
  autoRunner,
  "reviewed_by: null",
  'Autopilot WHY acceptance must not impersonate a human reviewer.',
)
requireText(
  manualIntentActions,
  "review_source: 'manual'",
  'Manual Buyer Situation review must retain human-review provenance.',
)
requireText(
  manualPromptActions,
  "review_source: 'manual'",
  'Manual buyer-question review must retain human-review provenance.',
)
requireText(
  manualWhyActions,
  "review_source: 'manual'",
  'Manual WHY review must retain human-review provenance.',
)

for (const name of [
  'intent-suggestor',
  'competitor-discovery',
  'prompt-expression-generator',
  'openai-observation-runner',
  'provider-observation-runner',
  'why-evaluator',
]) {
  const worker = trustedWorkerFunctions.find((item) => item.name === name)
  requireText(
    worker.source,
    "ctx.authMode === 'user' ? 'consume_ai_budget' : 'consume_ai_budget_internal'",
    name + ' must route trusted worker usage through the service-role-only AI budget RPC.',
  )
}

console.log('Methodology invariants passed.')
