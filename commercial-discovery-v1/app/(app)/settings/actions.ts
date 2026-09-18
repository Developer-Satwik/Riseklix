'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const profileSchema = z.object({
  display_name: z.string().trim().min(2).max(80),
})

const workspaceSchema = z.object({
  organization_name: z.string().trim().min(2).max(120),
})

const researchDefaultsSchema = z.object({
  default_market: z.enum(['India', 'United States', 'United Kingdom', 'UAE', 'Singapore', 'Australia']),
  default_analysis_mode: z.enum(['manual', 'autopilot']),
  default_primary_language: z.enum(['English', 'Hindi', 'Hinglish']),
})

async function requireUser() {
  const supabase = await createClient()
  const { data: claims, error } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub

  if (error || typeof userId !== 'string') redirect('/login')
  return { supabase, userId }
}

export async function updateProfile(formData: FormData) {
  const parsed = profileSchema.safeParse({
    display_name: formData.get('display_name'),
  })

  if (!parsed.success) {
    redirect('/settings?section=profile&error=' + encodeURIComponent('Enter a name between 2 and 80 characters'))
  }

  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: parsed.data.display_name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) redirect('/settings?section=profile&error=' + encodeURIComponent(error.message))
  redirect('/settings?section=profile&message=' + encodeURIComponent('Profile updated'))
}

export async function updateWorkspace(formData: FormData) {
  const parsed = workspaceSchema.safeParse({
    organization_name: formData.get('organization_name'),
  })

  if (!parsed.success) {
    redirect('/settings?section=workspace&error=' + encodeURIComponent('Enter an organization name between 2 and 120 characters'))
  }

  const { supabase, userId } = await requireUser()
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membership?.workspace_id) {
    redirect('/settings?section=workspace&error=' + encodeURIComponent('Only the workspace owner can rename this workspace'))
  }

  const { error } = await supabase
    .from('workspaces')
    .update({
      name: parsed.data.organization_name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', membership.workspace_id)

  if (error) redirect('/settings?section=workspace&error=' + encodeURIComponent(error.message))
  redirect('/settings?section=workspace&message=' + encodeURIComponent('Workspace updated'))
}

export async function updateResearchDefaults(formData: FormData) {
  const parsed = researchDefaultsSchema.safeParse({
    default_market: formData.get('default_market'),
    default_analysis_mode: formData.get('default_analysis_mode'),
    default_primary_language: formData.get('default_primary_language'),
  })

  if (!parsed.success) {
    redirect('/settings?section=research&error=' + encodeURIComponent('Choose valid research defaults'))
  }

  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('profiles')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) redirect('/settings?section=research&error=' + encodeURIComponent(error.message))
  redirect('/settings?section=research&message=' + encodeURIComponent('Research defaults updated'))
}

export async function revokeOtherSessions() {
  const { supabase } = await requireUser()
  const { error } = await supabase.auth.signOut({ scope: 'others' })

  if (error) redirect('/settings?section=security&error=' + encodeURIComponent(error.message))
  redirect('/settings?section=security&message=' + encodeURIComponent('Other signed-in sessions were revoked'))
}
