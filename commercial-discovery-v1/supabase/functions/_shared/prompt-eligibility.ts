export type UnaidedPromptEligibility =
  | { eligible: true; reason: 'commercial_option_discovery' }
  | { eligible: false; reason: 'informational_or_criteria_only' | 'empty' }

/**
 * Retrieval denominators only make sense when the unaided question asks the AI
 * to identify, recommend, compare or shortlist commercial options. Pure
 * criteria/advice questions (for example "what should I verify about a vendor")
 * may be useful research controls, but a target brand cannot fairly receive an
 * NR result when the question never asked for a recommendation set.
 */
export function classifyUnaidedPrompt(promptText: string): UnaidedPromptEligibility {
  const text = promptText.replace(/\s+/g, ' ').trim()
  if (!text) return { eligible: false, reason: 'empty' }

  const englishPatterns = [
    /\bwhich\b.{0,140}\b(platforms?|tools?|software|providers?|vendors?|companies|services?|solutions?|products?|options?|alternatives?|suppliers?|agencies|firms?|consultants?|programs?|networks?|banks?|carriers?|retailers?|brands?|systems?|apps?|applications?)\b/i,
    /\bwhat\b.{0,100}\b(platforms?|tools?|software|providers?|vendors?|companies|services?|solutions?|products?|options?|alternatives?|suppliers?|agencies|firms?|consultants?|programs?|networks?|banks?|carriers?|retailers?|brands?|systems?|apps?|applications?)\b.{0,100}\b(should|can|could|would)\b/i,
    /\b(recommend|recommendation|recommendations|shortlist|shortlisted|compare|comparison|alternatives?|options?)\b/i,
    /\b(best|top)\b.{0,140}\b(platforms?|tools?|software|providers?|vendors?|companies|services?|solutions?|products?|suppliers?|agencies|firms?|consultants?|programs?|networks?|banks?|carriers?|retailers?|brands?|systems?|apps?|applications?)\b/i,
    /\bwho\b.{0,100}\b(can|could|should|offers?|provides?|speciali[sz]es?)\b/i,
    /\b(list|find|show me|give me)\b.{0,100}\b(platforms?|tools?|software|providers?|vendors?|companies|services?|solutions?|products?|suppliers?|agencies|firms?|consultants?|programs?|networks?|banks?|carriers?|retailers?|brands?|systems?|apps?|applications?)\b/i,
  ]

  const romanizedIndicPatterns = [
    /\b(kaun|kaunsa|kaunsi|kaunse|konsa|konsi|konse)\b/i,
    /\b(recommend|best|compare|shortlist|options?|alternatives?|suggest)\b/i,
  ]

  const devanagariPatterns = [
    /कौन/,
    /विकल्प/,
    /शॉर्टलिस्ट/,
    /तुलना/,
    /सुझा/,
    /बेहतर/,
    /सबसे\s+अच्छ/,
  ]

  const eligible = [...englishPatterns, ...romanizedIndicPatterns, ...devanagariPatterns]
    .some((pattern) => pattern.test(text))

  return eligible
    ? { eligible: true, reason: 'commercial_option_discovery' }
    : { eligible: false, reason: 'informational_or_criteria_only' }
}

export function isUnaidedRetrievalEligible(promptText: string) {
  return classifyUnaidedPrompt(promptText).eligible
}
