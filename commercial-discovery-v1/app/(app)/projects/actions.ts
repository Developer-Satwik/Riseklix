'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const deleteSchema = z.object({
  project_id: z.string().uuid(),
  confirmation: z.string().trim().min(1),
})

export async function deleteAnalysis(formData: FormData) {
  const parsed = deleteSchema.safeParse({
    project_id: formData.get('project_id'),
    confirmation: formData.get('confirmation'),
  })

  if (!parsed.success) {
    redirect('/projects?error=' + encodeURIComponent('Could not verify the analysis to delete'))
  }

  const supabase = await createClient()
  const { data: claims, error: authError } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub

  if (authError || typeof userId !== 'string') redirect('/login')

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id,name,workspace_id')
    .eq('id', parsed.data.project_id)
    .maybeSingle()

  if (projectError || !project) {
    redirect('/projects?error=' + encodeURIComponent('Analysis not found or you no longer have access'))
  }

  if (parsed.data.confirmation !== project.name) {
    redirect('/projects?error=' + encodeURIComponent('Type the company name exactly to confirm deletion'))
  }

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', project.workspace_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (membership?.role !== 'owner') {
    redirect('/projects?error=' + encodeURIComponent('Only the workspace owner can permanently delete an analysis'))
  }

  const { error: deleteError } = await supabase
    .from('projects')
    .delete()
    .eq('id', project.id)

  if (deleteError) {
    redirect('/projects?error=' + encodeURIComponent(deleteError.message))
  }

  revalidatePath('/projects')
  redirect('/projects?message=' + encodeURIComponent(project.name + ' analysis deleted'))
}
