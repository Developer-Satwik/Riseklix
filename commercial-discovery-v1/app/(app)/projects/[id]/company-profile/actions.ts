'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({ project_id: z.string().uuid() })

export async function runCompanyResearch(formData: FormData) {
  const parsed = schema.safeParse({ project_id: formData.get('project_id') })
  if (!parsed.success) redirect('/projects?error=Invalid+project')

  const supabase = await createClient()
  const { data: claims, error: claimsError } = await supabase.auth.getClaims()
  if (claimsError || !claims?.claims?.sub) redirect('/login')

  const { data, error } = await supabase.functions.invoke('company-research', {
    body: { project_id: parsed.data.project_id },
  })

  if (error) {
    redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent(error.message)}`)
  }

  if (data?.error) {
    redirect(`/projects/${parsed.data.project_id}/company-profile?error=${encodeURIComponent(String(data.error))}`)
  }

  const reused = data?.reused ? 'Existing+research+capture+reused' : 'Homepage+evidence+captured'
  redirect(`/projects/${parsed.data.project_id}/company-profile?message=${reused}`)
}
