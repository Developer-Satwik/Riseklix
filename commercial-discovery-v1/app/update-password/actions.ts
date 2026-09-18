'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  password: z.string().min(10).max(128),
  confirm_password: z.string().min(10).max(128),
}).refine((value) => value.password === value.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})

export async function updatePassword(formData: FormData) {
  const parsed = schema.safeParse({
    password: formData.get('password'),
    confirm_password: formData.get('confirm_password'),
  })

  if (!parsed.success) redirect('/update-password?error=' + encodeURIComponent(parsed.error.issues[0]?.message || 'Enter matching passwords of at least 10 characters'))

  const supabase = await createClient()
  const { data: claims, error: authError } = await supabase.auth.getClaims()
  if (authError || !claims?.claims?.sub) redirect('/login?error=' + encodeURIComponent('Open the newest recovery link and try again'))

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) redirect('/update-password?error=' + encodeURIComponent(error.message))

  redirect('/projects?message=' + encodeURIComponent('Password updated'))
}
