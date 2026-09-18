import { withSupabase } from 'npm:@supabase/server'
import OpenAI from 'npm:openai'

type ResearchRequest = { project_id?: string; regenerate?: boolean }
type CapturedPage = { url: string; title: string | null; description: string | null; snapshot_hash: string; source_role: string }

const MAX_PAGE_BYTES = 500_000
const MAX_SITEMAP_BYTES = 300_000
const MAX_PAGES = 8

const INDEX_FALLBACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pages', 'limitations'],
  properties: {
    pages: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url','title','description','text_sample','source_role'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          text_sample: { type: 'string' },
          source_role: { type: 'string', enum: ['homepage_seed','commercial_capability','company_identity','geography_evidence','buyer_context','proof','supporting_page'] },
        },
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
} as const

class HttpStatusError extends Error {
  status: number
  url: string
  constructor(status: number, url: string) {
    super('HTTP ' + status)
    this.status = status
    this.url = url
  }
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function outputText(response: unknown) {
  const value = record(response)
  if (typeof value.output_text === 'string') return value.output_text
  const output = Array.isArray(value.output) ? value.output : []
  for (const item of output) {
    const message = record(item)
    const parts = Array.isArray(message.content) ? message.content : []
    for (const part of parts) {
      const block = record(part)
      if (typeof block.text === 'string') return block.text
    }
  }
  return ''
}


function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function normalizedHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, '').replace(/^\[|\]$/g, '')
}

function isUnsafeHost(hostname: string) {
  const host = normalizedHost(hostname)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host === '0.0.0.0') return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  const match = host.match(/^172\.(\d+)\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

function normalizeWebsite(domain: string) {
  const raw = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported website protocol')
  if (isUnsafeHost(url.hostname)) throw new Error('Private or local network targets are not allowed')
  url.hash = ''
  url.search = ''
  return url
}

function assertSameSite(url: URL, siteHost: string) {
  if (isUnsafeHost(url.hostname)) throw new Error('Private or local network redirect blocked')
  if (normalizedHost(url.hostname) !== siteHost) throw new Error('Cross-domain redirect blocked')
}

async function readLimitedText(response: Response, byteLimit: number) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > byteLimit) {
      await reader.cancel()
      break
    }
    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}

function extractTitle(html: string) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? null
}

function extractDescription(html: string) {
  const first = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)?.[1]
  const second = html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i)?.[1]
  return (first ?? second)?.replace(/\s+/g, ' ').trim().slice(0, 1000) ?? null
}

function textSample(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30_000)
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function fetchHtml(url: URL, siteHost: string) {
  assertSameSite(url, siteHost)
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 RiseklixResearch/0.3',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(15_000),
  })

  const finalUrl = new URL(response.url || url.toString())
  assertSameSite(finalUrl, siteHost)
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok) throw new HttpStatusError(response.status, finalUrl.toString())
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error(`Unsupported content type: ${contentType || 'unknown'}`)

  const html = await readLimitedText(response, MAX_PAGE_BYTES)
  return { response, finalUrl, html }
}

function internalLinks(html: string, base: URL, siteHost: string) {
  const links: URL[] = []
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const candidate = new URL(match[1], base)
      if (!['http:', 'https:'].includes(candidate.protocol)) continue
      if (normalizedHost(candidate.hostname) !== siteHost || isUnsafeHost(candidate.hostname)) continue
      candidate.hash = ''
      candidate.search = ''
      links.push(candidate)
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return links
}

async function sitemapLinks(base: URL, siteHost: string) {
  try {
    const sitemap = new URL('/sitemap.xml', base)
    const response = await fetch(sitemap, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36 RiseklixResearch/0.3', Accept: 'application/xml,text/xml,text/plain', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return [] as URL[]
    const final = new URL(response.url || sitemap.toString())
    assertSameSite(final, siteHost)
    const xml = await readLimitedText(response, MAX_SITEMAP_BYTES)
    const urls: URL[] = []
    for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
      try {
        const candidate = new URL(match[1].trim())
        if (normalizedHost(candidate.hostname) !== siteHost || isUnsafeHost(candidate.hostname)) continue
        candidate.hash = ''
        candidate.search = ''
        urls.push(candidate)
      } catch {
        // Ignore malformed sitemap entries.
      }
    }
    return urls
  } catch {
    return [] as URL[]
  }
}

function pageScore(url: URL) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/'
  if (path === '/') return 100
  if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|xml|json|docx?|xlsx?|pptx?)$/i.test(path)) return -100
  if (/(privacy|terms|cookie|login|sign-in|signup|cart|checkout|author|tag|wp-json)/.test(path)) return -50

  let score = 0
  const signals: Array<[RegExp, number]> = [
    [/(product|service|solution|capabilit|rental|rent)/, 9],
    [/(about|company|who-we-are|why-us)/, 8],
    [/(location|warehouse|branch|office|contact)/, 7],
    [/(industr|sector|market|use-case|application)/, 6],
    [/(case-stud|project|client|customer|portfolio)/, 5],
    [/(certif|quality|safety|compliance|standard)/, 5],
    [/(pricing|plans|commercial)/, 4],
    [/(blog|news|insight|article)/, 1],
  ]
  for (const [pattern, weight] of signals) if (pattern.test(path)) score += weight
  score -= Math.max(0, path.split('/').filter(Boolean).length - 2)
  return score
}

function selectPages(home: URL, candidates: URL[]) {
  const deduped = new Map<string, URL>()
  for (const url of [home, ...candidates]) {
    const key = `${normalizedHost(url.hostname)}${url.pathname.replace(/\/$/, '') || '/'}`
    if (!deduped.has(key)) deduped.set(key, url)
  }

  return [...deduped.values()]
    .map((url) => ({ url, score: pageScore(url) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.url.pathname.length - b.url.pathname.length)
    .slice(0, MAX_PAGES)
    .map((item) => item.url)
}

function sourceRole(url: URL) {
  const path = url.pathname.toLowerCase()
  if (path === '/' || path === '') return 'homepage_seed'
  if (/(product|service|solution|capabilit|rental|rent)/.test(path)) return 'commercial_capability'
  if (/(about|company|who-we-are|why-us)/.test(path)) return 'company_identity'
  if (/(location|warehouse|branch|office|contact)/.test(path)) return 'geography_evidence'
  if (/(industr|sector|market|use-case|application)/.test(path)) return 'buyer_context'
  if (/(case-stud|project|client|customer|portfolio)/.test(path)) return 'proof'
  return 'supporting_page'
}

async function indexedFirstPartyFallback(domain: string, siteHost: string, directStatus: number) {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('The website blocks direct automated research (HTTP ' + directStatus + ') and the indexed-web fallback requires OPENAI_API_KEY.')

  const model = Deno.env.get('RISEKLIX_CRAWL_FALLBACK_MODEL') || 'gpt-5.6-luna'
  const openai = new OpenAI({ apiKey })
  const response = await openai.responses.create({
    model,
    reasoning: { effort: 'none' },
    tools: [{ type: 'web_search_preview', search_context_size: 'medium' }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    instructions: `You are the fallback company-evidence collector for Riseklix.

The target company's website refused direct automated fetching. Use web search only to recover evidence from FIRST-PARTY URLs on the exact target domain.

Rules:
1. Include only URLs whose hostname is the target domain or its www variant.
2. Prefer the homepage plus commercial capability, about/company, services/products, location/contact, case-study/proof, audience/use-case and pricing/business-model pages.
3. Do not include third-party profiles, social media, directories or news sites.
4. text_sample must be a concise evidence summary grounded only in the surfaced first-party page/snippet. Do not invent facts.
5. If a fact cannot be verified through indexed evidence, omit it and add a limitation.
6. This is an indexed-web fallback, not a direct crawl. Do not imply the page was fetched directly.
7. Return a small high-signal set; duplicate URLs are not useful.`,
    input: 'Target domain: ' + domain + '\nResearch only first-party URLs on this domain.',
    text: {
      format: {
        type: 'json_schema',
        name: 'riseklix_indexed_first_party_fallback',
        strict: true,
        schema: INDEX_FALLBACK_SCHEMA,
      },
    },
  })

  const raw = outputText(response)
  if (!raw) throw new Error('Indexed-web fallback returned no structured evidence')
  const parsed = JSON.parse(raw) as { pages: Array<{ url: string; title: string; description: string; text_sample: string; source_role: string }>; limitations: string[] }

  const pages = parsed.pages.filter((page) => {
    try {
      const url = new URL(page.url)
      return ['http:','https:'].includes(url.protocol) && normalizedHost(url.hostname) === siteHost
    } catch {
      return false
    }
  })

  if (!pages.length) throw new Error('The website blocks direct automated research (HTTP ' + directStatus + '), and the indexed-web fallback found no usable first-party pages.')

  return { pages, limitations: parsed.limitations, model }
}

const handler = {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    let body: ResearchRequest
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const projectId = body.project_id?.trim()
    if (!projectId) return json({ error: 'project_id is required' }, 400)

    const { data: project, error: projectError } = await ctx.supabase
      .from('projects')
      .select('id,workspace_id,domain,name')
      .eq('id', projectId)
      .single()

    if (projectError || !project) return json({ error: 'Project not found or access denied' }, 404)

    const userId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '') || null
    const day = new Date().toISOString().slice(0, 10)
    const idempotencyKey = `company-first-party:${project.id}:${day}`

    const existing = await ctx.supabase
      .from('research_jobs')
      .select('id,status,progress,stage,output')
      .eq('project_id', project.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (existing.data && ['queued', 'running', 'succeeded'].includes(existing.data.status)) return json({ job: existing.data, reused: true })

    const { data: job, error: jobError } = await ctx.supabase
      .from('research_jobs')
      .insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        created_by: userId,
        job_type: 'company_research',
        status: 'running',
        progress: 5,
        stage: 'fetching_homepage',
        idempotency_key: idempotencyKey,
        input: { domain: project.domain, max_pages: MAX_PAGES },
        started_at: new Date().toISOString(),
      })
      .select('id,status,progress,stage')
      .single()

    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start research job' }, 400)

    try {
      const website = normalizeWebsite(project.domain)
      const siteHost = normalizedHost(website.hostname)
      const homepage = await fetchHtml(website, siteHost)

      await ctx.supabase.from('research_jobs').update({ progress: 20, stage: 'discovering_first_party_pages' }).eq('id', job.id)
      const [sitemap, homepageLinks] = await Promise.all([
        sitemapLinks(homepage.finalUrl, siteHost),
        Promise.resolve(internalLinks(homepage.html, homepage.finalUrl, siteHost)),
      ])
      const selected = selectPages(homepage.finalUrl, [...sitemap, ...homepageLinks])

      const captured: CapturedPage[] = []
      const failures: Array<{ url: string; error: string }> = []

      for (let index = 0; index < selected.length; index += 1) {
        const target = selected[index]
        try {
          const page = target.toString() === homepage.finalUrl.toString() ? homepage : await fetchHtml(target, siteHost)
          const sample = textSample(page.html)
          if (sample.length < 80) throw new Error('Page contained too little extractable text')
          const title = extractTitle(page.html) ?? project.name
          const description = extractDescription(page.html)
          const hash = await sha256(sample)
          const finalUrl = page.finalUrl.toString()
          const role = sourceRole(page.finalUrl)

          const { error: sourceError } = await ctx.supabase
            .from('research_sources')
            .upsert({
              workspace_id: project.workspace_id,
              project_id: project.id,
              url: finalUrl,
              title,
              source_type: 'first_party',
              captured_at: new Date().toISOString(),
              snapshot_hash: hash,
              metadata: {
                http_status: page.response.status,
                content_type: page.response.headers.get('content-type'),
                description,
                text_sample: sample,
                source_role: role,
                discovery_score: pageScore(page.finalUrl),
              },
            }, { onConflict: 'project_id,url' })

          if (sourceError) throw sourceError
          captured.push({ url: finalUrl, title, description, snapshot_hash: hash, source_role: role })
        } catch (error) {
          failures.push({ url: target.toString(), error: error instanceof Error ? error.message : 'Unknown page error' })
        }

        const progress = Math.min(90, 25 + Math.round(((index + 1) / Math.max(selected.length, 1)) * 65))
        await ctx.supabase.from('research_jobs').update({ progress, stage: 'capturing_first_party_pages' }).eq('id', job.id)
      }

      if (!captured.length) throw new Error('No usable first-party pages could be captured')

      await ctx.supabase.from('projects').update({ status: 'profile_review' }).eq('id', project.id)
      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded',
        progress: 100,
        stage: 'first_party_capture_complete',
        output: {
          pages_captured: captured.length,
          pages_failed: failures.length,
          captured,
          failures,
          discovery: { sitemap_candidates: sitemap.length, homepage_link_candidates: homepageLinks.length },
        },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      return json({
        job: { ...job, status: 'succeeded', progress: 100, stage: 'first_party_capture_complete' },
        pages: captured,
        failures,
        next: 'First-party evidence set captured. Company-profile interpretation and outside-in evidence discovery are the next research stages.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown research error'
      await ctx.supabase.from('research_jobs').update({
        status: 'failed',
        stage: 'first_party_capture_failed',
        error: { message },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)
      return json({ error: message, job_id: job.id }, 422)
    }
  }),
}

export default handler
