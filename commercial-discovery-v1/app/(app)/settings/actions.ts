'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  display_name: z.string().trim().min(2).max(80),
  organization_name: z.string().trim().min(2).max(120),
})

export async function updateWorkspaceIdentity(formData: FormData) {
  const parsed = schema.safeParse({
    display_name: formData.get('display_name'),
    organization_name: formData.get('organization_name'),
  })

  if (!parsed.success) redirect('/settings?error=' + encodeURIComponent('Enter a valid name and organization name'))

  const supabase = await createClient()
  const { data: claims, error: authError } = await supabase.auth.getClaims()
  if (authError || !claims?.claims?.sub) redirect('/login')

  const { error } = await supabase.rpc('complete_onboarding', {
    p_display_name: parsed.data.display_name,
    p_organization_name: parsed.data.organization_name,
  })

  if (error) redirect('/settings?error=' + encodeURIComponent(error.message))
  redirect('/settings?message=' + encodeURIComponent('Workspace details updated'))
}
