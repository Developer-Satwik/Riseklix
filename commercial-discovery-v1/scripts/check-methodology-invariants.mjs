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
const buyerSituationsPage = read('app/(app)/projects/[id]/buyer-situations/page.tsx')
const whyPage = read('app/(app)/projects/[id]/why/page.tsx')
const methodPage = read('app/(app)/projects/[id]/method/page.tsx')
const notificationFlow = read('lib/analysis-notifications.ts')
const notificationSetting = read('components/analysis-notification-setting.tsx')
const processingClient = read('components/autopilot-processing-client.tsx')
const completionNotifier = read('components/analysis-completion-notifier.tsx')
const autopilotIntentSelection = read('supabase/functions/_shared/autopilot-intent-selection.ts')
const providerReadiness = read('supabase/functions/_shared/observation-provider-readiness.ts')
const providerPreflight = read('supabase/functions/observation-provider-preflight/index.ts')

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
  providerReadiness,
  'export const MIN_USABLE_PROVIDERS = 3',
  'Provider readiness must retain the three-provider minimum.',
)
requireText(
  observation,
  'configuredSurfaceProviders.length < MIN_USABLE_PROVIDERS',
  'Observation collection must refuse to spend provider calls when fewer than three configured systems are available.',
)
requireText(
  observation,
  "provider_availability: 'not_configured_at_collection_start'",
  'A declared provider that is unavailable at collection start must be recorded as an excluded provider outcome.',
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
  testActions,
  "supabase.functions.invoke('observation-provider-preflight'",
  'Manual baselines must preflight provider readiness before freezing a new panel.',
)
requireText(
  testActions,
  ".filter((surface) => configuredProviders.has(surface.provider))",
  'Manual baselines must only declare provider surfaces that were configured at panel creation.',
)
requireText(
  autopilot,
  'surfacePreview.length < MIN_USABLE_PROVIDERS',
  'Autopilot must refuse to create a benchmark when fewer than three provider surfaces are configured.',
)
requireText(
  providerPreflight,
  'configured_provider_count: configured.length',
  'Provider preflight must expose configuration readiness without requiring a benchmark.',
)
requireText(
  providerPreflight,
  "withSupabase({ auth: ['user','secret'] }",
  'Provider preflight must require an authenticated user or trusted worker context.',
)
requireText(
  providerPreflight,
  "const db = ctx.authMode === 'user' ? ctx.supabase : ctx.supabaseAdmin",
  'Provider preflight must validate project access through the caller-scoped database client.',
)
requireText(
  testActions,
  "body: { project_id: projectId }",
  'Manual provider preflight must be scoped to the project being benchmarked.',
)
forbidText(
  providerPreflight,
  'missingSecrets',
  'Provider preflight responses must not expose secret names to the application client.',
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


requireText(
  report,
  "review_source,is_current",
  'The report must retain finding review provenance instead of presenting automated acceptance as human review.',
)
requireText(
  report,
  "API proxies are not presented as equivalent to consumer-app interfaces.",
  'The report must keep API-proxy measurement boundaries visible.',
)
requireText(
  buyerSituationsPage,
  "Autopilot accepted · not human reviewed",
  'Buyer Situation and question UI must distinguish Autopilot acceptance from human review.',
)
requireText(
  buyerSituationsPage,
  "not retrieval-eligible",
  'Legacy informational unaided questions must remain visibly excluded from retrieval readiness.',
)
requireText(
  whyPage,
  "Autopilot accepted · not human reviewed",
  'WHY findings must distinguish Autopilot acceptance from human review.',
)
requireText(
  methodPage,
  "Automated acceptance never impersonates a human approver.",
  'Method documentation must preserve the review-provenance boundary.',
)


requireText(
  autopilot,
  'selectAutopilotIntentPortfolio(candidates, slots, alreadyApproved)',
  'Autopilot must select a commercial portfolio instead of taking the first N high-priority intents.',
)
requireText(
  autopilot,
  "selection_method: 'priority_provenance_revenue_nearness_plus_portfolio_novelty_v1'",
  'Autopilot intent triage must leave an auditable selection-method marker.',
)

const transpiledIntentSelection = ts.transpileModule(autopilotIntentSelection, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const intentSelectionModule = { exports: {} }
new Function('module', 'exports', transpiledIntentSelection)(
  intentSelectionModule,
  intentSelectionModule.exports,
)
const { selectAutopilotIntentPortfolio, intentDecisionFamily } = intentSelectionModule.exports

const portfolioCandidates = [
  { id: 'c1', intent_key: 'INT-001', priority: 'critical', provenance: 'adapted', title: 'Shortlist a shared inbox', purchase_stage: 'Vendor shortlist and capability comparison', job_to_be_done: 'Compare vendors for a shared inbox', required_capabilities: ['shared inbox'] },
  { id: 'c2', intent_key: 'INT-002', priority: 'critical', provenance: 'adapted', title: 'Validate chatbot handoff', purchase_stage: 'Technical qualification', job_to_be_done: 'Validate automation to human handoff', required_capabilities: ['chatbot', 'human handoff'] },
  { id: 'c3', intent_key: 'INT-003', priority: 'critical', provenance: 'adapted', title: 'Confirm another chatbot control', purchase_stage: 'Technical qualification', job_to_be_done: 'Validate another chatbot escalation control', required_capabilities: ['chatbot', 'human handoff'] },
  { id: 'c4', intent_key: 'INT-004', priority: 'critical', provenance: 'adapted', title: 'Confirm routing setup', purchase_stage: 'Technical qualification', job_to_be_done: 'Validate another technical routing requirement', required_capabilities: ['routing', 'handoff'] },
  { id: 'u1', intent_key: 'INT-005', priority: 'critical', provenance: 'adapted', title: 'Launch reorder journey', purchase_stage: 'Use-case evaluation', job_to_be_done: 'Automate ecommerce replenishment journeys', required_capabilities: ['reorder workflow'] },
  { id: 'h1', intent_key: 'INT-006', priority: 'high', provenance: 'adapted', title: 'Approve subscription budget', purchase_stage: 'Commercial evaluation and budget approval', job_to_be_done: 'Understand price limits and total cost', required_capabilities: ['pricing', 'subscription limits'] },
]
const portfolio = selectAutopilotIntentPortfolio(portfolioCandidates, 4)
if (portfolio.length !== 4) {
  throw new Error('Methodology invariant failed: Autopilot portfolio must respect its configured slot limit.')
}
const portfolioFamilies = new Set(portfolio.map(intentDecisionFamily))
if (portfolioFamilies.size < 4) {
  throw new Error('Methodology invariant failed: comparable intents should not collapse all Autopilot slots into one decision family.')
}
if (!portfolio.some((intent) => intent.id === 'h1')) {
  throw new Error('Methodology invariant failed: a commercially relevant high-priority novel decision can beat a redundant critical intent.')
}

const provenanceTie = selectAutopilotIntentPortfolio([
  { id: 'exploratory', intent_key: 'INT-020', priority: 'critical', provenance: 'exploratory', title: 'Shortlist vendors', purchase_stage: 'Vendor shortlist' },
  { id: 'adapted', intent_key: 'INT-021', priority: 'critical', provenance: 'adapted', title: 'Shortlist vendors', purchase_stage: 'Vendor shortlist' },
], 1)
if (provenanceTie[0]?.id !== 'adapted') {
  throw new Error('Methodology invariant failed: evidence-adapted intent should beat a comparable exploratory intent.')
}

const seededPortfolio = selectAutopilotIntentPortfolio([
  { id: 'selection-duplicate', intent_key: 'INT-030', priority: 'critical', provenance: 'adapted', title: 'Compare another vendor shortlist', purchase_stage: 'Vendor shortlist' },
  { id: 'technical-novel', intent_key: 'INT-031', priority: 'high', provenance: 'adapted', title: 'Validate integration requirements', purchase_stage: 'Technical qualification' },
], 1, [
  { id: 'existing-selection', intent_key: 'INT-029', priority: 'critical', provenance: 'adapted', title: 'Shortlist vendors', purchase_stage: 'Vendor shortlist' },
])
if (seededPortfolio[0]?.id !== 'technical-novel') {
  throw new Error('Methodology invariant failed: existing approved intents must influence remaining portfolio novelty.')
}


requireText(
  processingClient,
  'shouldOfferAnalysisNotifications()',
  'Autopilot processing must use the contextual soft notification prompt instead of requesting permission on page load.',
)
requireText(
  processingClient,
  'onClick={enableNotifications}',
  'The native notification permission request must remain behind an explicit user action.',
)
requireText(
  processingClient,
  'Not now',
  'The contextual notification prompt must offer a non-blocking dismissal path.',
)
forbidText(
  processingClient,
  'Turn off',
  'Processing must not expose a second disable-notifications control after opt-in; Settings owns ongoing notification management.',
)
requireText(
  notificationSetting,
  'disableAnalysisNotifications()',
  'Settings must retain the explicit notification opt-out control.',
)
requireText(
  notificationFlow,
  "Notification.requestPermission()",
  'Notification permission must be requested through the centralized permission flow.',
)
requireText(
  notificationFlow,
  'PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000',
  'Choosing Not now must suppress repeated notification prompts for a meaningful cooldown.',
)
requireText(
  completionNotifier,
  'if (!delivered) continue',
  'Failed browser notification delivery must remain retryable instead of being marked seen.',
)
requireText(
  completionNotifier,
  'seen.add(run.project_id)',
  'Successful completion notifications must still be deduplicated.',
)

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
