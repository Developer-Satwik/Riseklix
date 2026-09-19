export type FirecrawlDocument = {
  url: string
  title: string
  description: string
  markdown: string
  links: string[]
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function cleanText(value: unknown, max = 30_000) {
  return typeof value === 'string'
    ? value.replace(/\u0000/g, '').trim().slice(0, max)
    : ''
}

async function firecrawlRequest(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 60_000,
) {
  const response = await fetch('https://api.firecrawl.dev/v2' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  let payload: unknown = {}
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }

  if (!response.ok) {
    const data = record(payload)
    throw new Error(
      String(data.error || data.message || ('Firecrawl request failed with HTTP ' + response.status)),
    )
  }

  return record(payload)
}

export async function firecrawlScrape(
  apiKey: string,
  url: string,
  options: { location?: string; maxAgeMs?: number } = {},
): Promise<FirecrawlDocument> {
  const payload = await firecrawlRequest(apiKey, '/scrape', {
    url,
    formats: ['markdown', 'links'],
    onlyMainContent: true,
    blockAds: true,
    removeBase64Images: true,
    storeInCache: true,
    maxAge: options.maxAgeMs ?? 86_400_000,
    ...(options.location ? { location: { country: options.location } } : {}),
  })

  const data = record(payload.data)
  const metadata = record(data.metadata)
  const resolvedUrl = cleanText(metadata.sourceURL || metadata.url || url, 2_000) || url

  return {
    url: resolvedUrl,
    title: cleanText(metadata.title, 500),
    description: cleanText(metadata.description, 2_000),
    markdown: cleanText(data.markdown, 30_000),
    links: stringArray(data.links).slice(0, 250),
  }
}

export async function firecrawlSearch(
  apiKey: string,
  query: string,
  options: { limit?: number; location?: string; scrape?: boolean } = {},
): Promise<FirecrawlDocument[]> {
  const payload = await firecrawlRequest(apiKey, '/search', {
    query,
    limit: Math.min(Math.max(options.limit ?? 6, 1), 10),
    sources: ['web'],
    ...(options.location ? { location: options.location } : {}),
    ...(options.scrape === false
      ? {}
      : {
          scrapeOptions: {
            formats: ['markdown'],
            onlyMainContent: true,
            blockAds: true,
            removeBase64Images: true,
            storeInCache: true,
            maxAge: 86_400_000,
          },
        }),
  })

  const data = record(payload.data)
  const rows = Array.isArray(data.web) ? data.web : []

  return rows.map((row) => {
    const item = record(row)
    const metadata = record(item.metadata)
    return {
      url: cleanText(item.url || metadata.sourceURL, 2_000),
      title: cleanText(item.title || metadata.title, 500),
      description: cleanText(item.description || metadata.description, 2_000),
      markdown: cleanText(item.markdown, 12_000),
      links: stringArray(item.links).slice(0, 100),
    }
  }).filter((item) => item.url.startsWith('http'))
}
