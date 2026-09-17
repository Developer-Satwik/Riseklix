import { withSupabase } from 'npm:@supabase/server'

type ResearchRequest = { project_id?: string }

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function isUnsafeHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
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
  return url
}

async function readLimitedText(response: Response, byteLimit = 500_000) {
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

export default {
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
    const idempotencyKey = `company-homepage:${project.id}:${new Date().toISOString().slice(0, 10)}`

    const existing = await ctx.supabase
      .from('research_jobs')
      .select('id,status,progress,stage')
      .eq('project_id', project.id)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (existing.data && ['queued', 'running', 'succeeded'].includes(existing.data.status)) {
      return json({ job: existing.data, reused: true })
    }

    const { data: job, error: jobError } = await ctx.supabase
      .from('research_jobs')
      .insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        created_by: userId,
        job_type: 'company_research',
        status: 'running',
        progress: 10,
        stage: 'fetching_homepage',
        idempotency_key: idempotencyKey,
        input: { domain: project.domain },
        started_at: new Date().toISOString(),
      })
      .select('id,status,progress,stage')
      .single()

    if (jobError || !job) return json({ error: jobError?.message ?? 'Could not start research job' }, 400)

    try {
      const website = normalizeWebsite(project.domain)
      const response = await fetch(website, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'RiseklixResearchBot/0.1 (+commercial-discovery)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15_000),
      })

      const contentType = response.headers.get('content-type') ?? ''
      if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`)
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`Unsupported homepage content type: ${contentType || 'unknown'}`)
      }

      const html = await readLimitedText(response)
      const sample = textSample(html)
      const title = extractTitle(html) ?? project.name
      const description = extractDescription(html)
      const hash = await sha256(sample)
      const finalUrl = response.url || website.toString()

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
            http_status: response.status,
            content_type: contentType,
            description,
            text_sample: sample,
            source_role: 'homepage_seed',
          },
        }, { onConflict: 'project_id,url' })

      if (sourceError) throw sourceError

      await ctx.supabase.from('research_jobs').update({
        status: 'succeeded',
        progress: 100,
        stage: 'homepage_captured',
        output: { homepage_url: finalUrl, title, description, snapshot_hash: hash },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)

      return json({
        job: { ...job, status: 'succeeded', progress: 100, stage: 'homepage_captured' },
        source: { url: finalUrl, title, description, snapshot_hash: hash },
        next: 'First-party source captured. Company-profile interpretation and outside-in evidence discovery are the next research stages.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown research error'
      await ctx.supabase.from('research_jobs').update({
        status: 'failed',
        stage: 'homepage_failed',
        error: { message },
        completed_at: new Date().toISOString(),
      }).eq('id', job.id)
      return json({ error: message, job_id: job.id }, 422)
    }
  }),
}
