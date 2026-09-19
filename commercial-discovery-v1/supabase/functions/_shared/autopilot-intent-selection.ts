export type AutopilotIntentCandidate = {
  id: string
  intent_key: string
  priority: string
  provenance?: string | null
  title?: string | null
  buyer?: string | null
  job_to_be_done?: string | null
  purchase_stage?: string | null
  commercial_model?: string | null
  required_capabilities?: unknown
  created_at?: string | null
}

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','before','by','can','for','from','in','into','is','it','of','on','or','the','their',
  'to','use','using','with','without','while','who','what','which','our','your','customer','customers','business','businesses',
  'company','companies','provider','providers','platform','platforms','software','solution','solutions','service','services',
])

function normalize(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

function capabilityText(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && !Array.isArray(item) && 'text' in item) {
      return String((item as { text?: unknown }).text ?? '')
    }
    return ''
  }).filter(Boolean).join(' ')
}

function tokenSet(intent: AutopilotIntentCandidate) {
  const text = normalize([
    intent.title,
    intent.buyer,
    intent.job_to_be_done,
    intent.purchase_stage,
    intent.commercial_model,
    capabilityText(intent.required_capabilities),
  ].filter(Boolean).join(' '))

  return new Set(
    text.split(' ')
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
  )
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const item of a) if (b.has(item)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function priorityScore(value: string) {
  if (value === 'critical' || value === 'urgent') return 100
  if (value === 'high' || value === 'opportunity') return 78
  if (value === 'medium' || value === 'monitor') return 56
  return 34
}

function provenanceScore(value?: string | null) {
  if (value === 'observed') return 12
  if (value === 'adapted') return 8
  return 0
}

function revenueNearScore(intent: AutopilotIntentCandidate) {
  const text = normalize([intent.purchase_stage, intent.title, intent.job_to_be_done].filter(Boolean).join(' '))
  if (/shortlist|vendor selection|replacement|commercial evaluation|budget approval|technical qualification|procurement|pre contract|hands on product evaluation|sales assisted evaluation|implementation evaluation/.test(text)) return 5
  if (/use case evaluation|solution design|business case/.test(text)) return 3
  return 0
}

export function intentDecisionFamily(intent: AutopilotIntentCandidate) {
  const text = normalize([intent.purchase_stage, intent.title, intent.job_to_be_done].filter(Boolean).join(' '))

  if (/privacy|security|legal|compliance|due diligence|risk review|account risk/.test(text)) return 'diligence'
  if (/pricing|price|budget|commercial evaluation|procurement|contract|billing|total cost|subscription cost/.test(text)) return 'commercial'
  if (/trial|proof of concept|poc|guided demo|product evaluation|sales assisted|hands on/.test(text)) return 'evaluation'
  if (/technical|qualification|validate|validation|confirm|integration|availability|channel scope/.test(text)) return 'technical'
  if (/shortlist|vendor selection|capability comparison|replacement evaluation|replace /.test(text)) return 'selection'
  if (/implementation|solution design|launch|rollout|deploy/.test(text)) return 'implementation'
  if (/use case|automate|automation|journey|workflow|retention|reorder|post purchase|inquiry/.test(text)) return 'use_case'
  return 'other'
}

function stableTieBreak(a: AutopilotIntentCandidate, b: AutopilotIntentCandidate) {
  const aKey = a.intent_key || a.id
  const bKey = b.intent_key || b.id
  return aKey.localeCompare(bKey)
}

/**
 * Build a small, commercially useful Autopilot portfolio rather than simply
 * taking the first N high-priority model outputs.
 *
 * Priority remains the strongest signal. Provenance and revenue proximity help
 * break close decisions, while a modest novelty bonus prevents four benchmark
 * slots from collapsing onto near-duplicate stages/capability clusters.
 *
 * Diversity is never absolute: a materially more important intent can still
 * beat a lower-priority novel one.
 */
export function selectAutopilotIntentPortfolio<T extends AutopilotIntentCandidate>(
  candidates: T[],
  limit: number,
  existing: T[] = [],
) {
  if (limit <= 0 || !candidates.length) return [] as T[]

  const remaining = [...candidates]
  const selected: T[] = []
  const context: T[] = [...existing]

  while (selected.length < limit && remaining.length) {
    const families = new Set(context.map(intentDecisionFamily))
    const contextTokens = context.map(tokenSet)

    const ranked = remaining.map((intent) => {
      const family = intentDecisionFamily(intent)
      const tokens = tokenSet(intent)
      const maxSimilarity = contextTokens.length
        ? Math.max(...contextTokens.map((existingTokens) => jaccard(tokens, existingTokens)))
        : 0

      const noveltyBonus = context.length && !families.has(family) ? 20 : 0
      const repeatedFamilyPenalty = context.length && families.has(family) ? 6 : 0
      const similarityPenalty = Math.round(maxSimilarity * 30)

      return {
        intent,
        score:
          priorityScore(intent.priority)
          + provenanceScore(intent.provenance)
          + revenueNearScore(intent)
          + noveltyBonus
          - repeatedFamilyPenalty
          - similarityPenalty,
      }
    }).sort((a, b) => b.score - a.score || stableTieBreak(a.intent, b.intent))

    const winner = ranked[0].intent
    selected.push(winner)
    context.push(winner)

    const index = remaining.findIndex((intent) => intent.id === winner.id)
    remaining.splice(index, 1)
  }

  return selected
}
