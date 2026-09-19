'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isUnaidedRetrievalEligible } from '@/lib/prompt-eligibility'

const generationSchema = z.object({
  project_id: z.string().uuid(),
  intent_id: z.string().uuid(),
  regenerate: z.enum(['true', 'false']).optional(),
})

const reviewSchema = generationSchema.pick({ project_id: true, intent_id: true }).extend({
  prompt_id: z.string().uuid(),
})


async function edgeFunctionErrorMessage(error: unknown) {
  const candidate = error as { message?: string; context?: unknown } | null
  const fallback = candidate?.message || 'Question generation failed'
  const context = candidate?.context

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string; message?: string }
      if (payload?.error === 'reasoning_provider_not_configured') return 'OPENAI_API_KEY is not configured for question generation.'
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

async function auth() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (error || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

export async function generatePromptExpressions(formData: FormData) {
  const parsed = generationSchema.safeParse({
    project_id: formData.get('project_id'),
    intent_id: formData.get('intent_id'),
    regenerate: formData.get('regenerate') || undefined,
  })
  if (!parsed.success) redirect('/projects?error=Invalid+prompt+generation+request')

  const { supabase } = await auth()
  const { data, error } = await supabase.functions.invoke('prompt-expression-generator', {
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
      ? 'Prompt Expression Generator is deployed, but its reasoning-provider secret is not configured yet.'
      : String(data.message || data.error)
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(message)}`)
  }

  if (data?.pending) {
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(String(data.message || 'Buyer-question generation is running.'))}`)
  }

  const generated = typeof data?.generated === 'number' ? data.generated : Array.isArray(data?.expressions) ? data.expressions.length : 0
  const message = data?.reused ? `Existing prompt-expression set reused (${generated}).` : `${generated} prompt expressions generated for review.`
  redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(message)}`)
}

async function setPromptStatus(formData: FormData, status: 'approved' | 'rejected') {
  const parsed = reviewSchema.safeParse({
    project_id: formData.get('project_id'),
    intent_id: formData.get('intent_id'),
    prompt_id: formData.get('prompt_id'),
  })
  if (!parsed.success) redirect('/projects?error=Invalid+prompt+review+request')

  const { supabase, userId } = await auth()
  const { data: prompt, error: promptError } = await supabase
    .from('prompt_expressions')
    .select('id,workspace_id,buyer_intent_id,language,mode,variant_no,prompt_text,is_frozen')
    .eq('id', parsed.data.prompt_id)
    .eq('project_id', parsed.data.project_id)
    .eq('buyer_intent_id', parsed.data.intent_id)
    .single()

  if (promptError || !prompt) redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent('Prompt expression could not be loaded')}`)
  if (prompt.is_frozen) redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent('Frozen benchmark prompts cannot be re-reviewed. Create a new version instead.')}`)
  if (status === 'approved' && prompt.mode === 'unaided' && !isUnaidedRetrievalEligible(prompt.prompt_text)) {
    redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent('This unaided question asks for criteria or advice rather than named commercial options. Edit or regenerate it before using it in a retrieval benchmark.')}`)
  }

  const { error } = await supabase.from('prompt_expressions').update({
    status,
    approved_by: status === 'approved' ? userId : null,
    approved_at: status === 'approved' ? new Date().toISOString() : null,
    review_source: 'manual',
  }).eq('id', prompt.id)

  if (error) redirect(`/projects/${parsed.data.project_id}/buyer-situations?error=${encodeURIComponent(error.message)}`)

  await supabase.from('audit_events').insert({
    workspace_id: prompt.workspace_id,
    project_id: parsed.data.project_id,
    actor_user_id: userId,
    event_type: `prompt_expression_${status}`,
    entity_type: 'buyer_intent',
    entity_id: parsed.data.intent_id,
    payload: { prompt_expression_id: prompt.id, language: prompt.language, mode: prompt.mode, variant_no: prompt.variant_no },
  })

  redirect(`/projects/${parsed.data.project_id}/buyer-situations?message=${encodeURIComponent(`Prompt expression ${status}`)}`)
}

export async function approvePromptExpression(formData: FormData) {
  return setPromptStatus(formData, 'approved')
}

export async function rejectPromptExpression(formData: FormData) {
  return setPromptStatus(formData, 'rejected')
}
