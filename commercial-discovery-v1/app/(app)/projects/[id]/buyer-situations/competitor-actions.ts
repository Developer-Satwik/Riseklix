'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'


async function edgeFunctionErrorMessage(error: unknown) {
  const candidate = error as { message?: string; context?: unknown } | null
  const fallback = candidate?.message || 'Competitor research failed'
  const context = candidate?.context

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string; message?: string }
      if (payload?.error === 'reasoning_provider_not_configured') {
        return 'OPENAI_API_KEY is not configured in Supabase Edge Function Secrets.'
      }
      return payload?.message || payload?.error || fallback
    } catch {
      try {
        const body = await context.clone().text()
        return body || fallback
      } catch {
        return fallback
      }
    }
  }

  return fallback
}

const schema = z.object({
  project_id: z.string().uuid(),
  intent_id: z.string().uuid(),
  regenerate: z.enum(['true', 'false']).optional(),
})

export async function discoverCompetitors(formData: FormData) {
  const parsed = schema.safeParse({
    project_id: formData.get('project_id'),
    intent_id: formData.get('intent_id'),
    regenerate: formData.get('regenerate') || undefined,
  })

  if (!parsed.success) redirect('/projects?error=Invalid+competitor+discovery+request')

  const supabase = await createClient()
  const { data: claims, error: claimsError } = await supabase.auth.getClaims()
  if (claimsError || !claims?.claims?.sub) redirect('/login')

  const { data, error } = await supabase.functions.invoke('competitor-discovery', {
    body: {
      project_id: parsed.data.project_id,
      intent_id: parsed.data.intent_id,
      regenerate: parsed.data.regenerate === 'true',
    },
  })

  if (error) {
    const detail = await edgeFunctionErrorMessage(error)
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(detail)}`)
  }

  if (data?.error) {
    const message = data.error === 'reasoning_provider_not_configured'
      ? 'Competitor Discovery is deployed, but its reasoning-provider secret is not configured yet.'
      : String(data.message || data.error)
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(message)}`)
  }

  if (data?.pending) {
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(String(data.message || 'Competitor research is running in the background.'))}`)
  }

  const generated = typeof data?.generated === 'number'
    ? data.generated
    : Array.isArray(data?.competitors) ? data.competitors.length : 0

  const message = data?.reused
    ? `Existing evidence-backed competitor set reused (${generated}).`
    : `${generated} evidence-backed competitors discovered for this Buyer Intent.`

  redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(message)}`)
}
