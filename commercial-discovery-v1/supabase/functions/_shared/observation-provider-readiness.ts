export type ObservationProvider = 'openai' | 'google' | 'anthropic' | 'perplexity'

export const MIN_USABLE_PROVIDERS = 3

type ProviderSpec = {
  provider: ObservationProvider
  displayName: string
  requiredSecrets: string[]
}

const PROVIDER_SPECS: ProviderSpec[] = [
  { provider: 'openai', displayName: 'OpenAI', requiredSecrets: ['OPENAI_API_KEY'] },
  { provider: 'google', displayName: 'Gemini', requiredSecrets: ['GEMINI_API_KEY'] },
  { provider: 'anthropic', displayName: 'Claude', requiredSecrets: ['ANTHROPIC_API_KEY', 'FIRECRAWL_API_KEY'] },
  { provider: 'perplexity', displayName: 'Perplexity', requiredSecrets: ['PERPLEXITY_API_KEY'] },
]

export function observationProviderReadiness() {
  return PROVIDER_SPECS.map((spec) => {
    const missingSecrets = spec.requiredSecrets.filter((name) => !Deno.env.get(name))
    return {
      provider: spec.provider,
      displayName: spec.displayName,
      configured: missingSecrets.length === 0,
      missingSecrets,
    }
  })
}

export function configuredObservationProviders() {
  return observationProviderReadiness()
    .filter((item) => item.configured)
    .map((item) => item.provider)
}
