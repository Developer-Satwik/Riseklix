import { getContext } from '@netlify/functions'

export type SupportedMarket =
  | 'Global'
  | 'India'
  | 'United States'
  | 'United Kingdom'
  | 'UAE'
  | 'Singapore'
  | 'Australia'

const COUNTRY_TO_MARKET: Record<string, SupportedMarket> = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  AE: 'UAE',
  SG: 'Singapore',
  AU: 'Australia',
}

export function marketFromCountryCode(countryCode?: string | null): SupportedMarket {
  if (!countryCode) return 'Global'
  return COUNTRY_TO_MARKET[countryCode.toUpperCase()] ?? 'Global'
}

export function getRequestDefaultMarket(): SupportedMarket {
  try {
    return marketFromCountryCode(getContext().geo?.country?.code)
  } catch {
    // Local development and non-Netlify runtimes do not expose Netlify request context.
    return 'Global'
  }
}
