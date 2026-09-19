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

  const criteriaOnlyPatterns = [
    /\bwhat\s+(?:should|do)\s+(?:i|we)\s+(?:verify|check|look\s+for|consider|compare|evaluate|ask)\b/i,
    /\bhow\s+(?:should|do|can|could)\s+(?:i|we)\s+(?:verify|check|evaluate|compare|assess|choose)\b/i,
    /\bwhat\s+(?:criteria|factors|features|questions|requirements|checks)\b/i,
    /\b(?:kya|kin\s+cheezon?)\s+(?:check|verify|compare|dekh|pooch)\b/i,
    /(?:क्या|किन\s+चीज़ों|किन\s+चीजों).{0,50}(?:जाँच|जांच|देख|तुलना|पूछ)/,
  ]
  if (criteriaOnlyPatterns.some((pattern) => pattern.test(text))) {
    return { eligible: false, reason: 'informational_or_criteria_only' }
  }

  const commercialOptionNouns =
    '(?:platforms?|tools?|software|providers?|vendors?|companies|services?|solutions?|products?|options?|alternatives?|suppliers?|agencies|firms?|consultants?|programs?|networks?|banks?|carriers?|retailers?|brands?|systems?|apps?|applications?)'

  const englishPatterns = [
    new RegExp('\\bwhich\\b.{0,140}\\b' + commercialOptionNouns + '\\b', 'i'),
    new RegExp('\\bwhat\\b.{0,100}\\b' + commercialOptionNouns + '\\b.{0,100}\\b(should|can|could|would)\\b', 'i'),
    new RegExp('\\b(compare|comparing)\\b.{0,100}\\b' + commercialOptionNouns + '\\b', 'i'),
    /\b(recommend|recommendation|recommendations|shortlist|shortlisted|alternatives?|options?)\b/i,
    new RegExp('\\b(best|top)\\b.{0,140}\\b' + commercialOptionNouns + '\\b', 'i'),
    /\bwho\b.{0,100}\b(can|could|should|offers?|provides?|speciali[sz]es?)\b/i,
    new RegExp('\\b(list|find|show me|give me)\\b.{0,100}\\b' + commercialOptionNouns + '\\b', 'i'),
  ]

  const romanizedIndicPatterns = [
    /\b(kaun|kaunsa|kaunsi|kaunse|konsa|konsi|konse)\b/i,
    /\b(recommend|shortlist|options?|alternatives?)\b/i,
  ]

  const devanagariPatterns = [
    /कौन/,
    /विकल्प/,
    /शॉर्टलिस्ट/,
    /सुझा/,
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
