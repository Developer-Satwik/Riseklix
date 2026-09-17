'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({ project_id: z.string().uuid() })

export async function generateBuyerIntents(formData: FormData) {
  const parsed = schema.safeParse({ project_id: formData.get('project_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+project')

  const supabase = await createClient()
  const { data: claims, error: claimsError } = await supabase.auth.getClaims()
  if (claimsError || !claims?.claims?.sub) redirect('/login')

  const { data, error } = await supabase.functions.invoke('intent-suggestor', {
    body: { project_id: parsed.data.project_id },
  })

  if (error) {
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(error.message)}`)
  }

  if (data?.error) {
    const message = data.error === 'reasoning_provider_not_configured'
      ? 'Buyer Intent AI is ready but the reasoning-provider secret is not configured yet.'
      : String(data.message || data.error)
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(message)}`)
  }

  const generated = Array.isArray(data?.intents) ? data.intents.length : 0
  const message = data?.reused
    ? 'Existing Buyer Intent generation reused.'
    : `${generated} Buyer Intent candidates generated for review.`

  redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(message)}`)
}
