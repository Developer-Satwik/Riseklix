'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export async function login(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) redirect('/login?error=Enter+a+valid+email+and+8%2B+character+password')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  redirect('/projects')
}

export async function signup(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) redirect('/login?error=Enter+a+valid+email+and+8%2B+character+password')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      data: { display_name: parsed.data.email.split('@')[0] },
    },
  })

  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  if (data.session) redirect('/projects')
  redirect('/login?message=Check+your+email+to+confirm+your+account')
}
