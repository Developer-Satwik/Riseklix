'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSiteUrl } from '@/lib/site-url'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  captcha_token: z.string().optional(),
})

function requireCaptcha(token?: string) {
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !token) {
    redirect('/login?error=' + encodeURIComponent('Complete the security check and try again'))
  }
}

async function redirectAfterAuth(userId: string) {
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', userId)
    .maybeSingle()

  redirect(profile?.onboarding_completed_at ? '/projects' : '/onboarding')
}

export async function login(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    captcha_token: formData.get('captcha_token') || undefined,
  })

  if (!parsed.success) redirect('/login?error=' + encodeURIComponent('Enter a valid email and password'))
  requireCaptcha(parsed.data.captcha_token)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    options: parsed.data.captcha_token ? { captchaToken: parsed.data.captcha_token } : undefined,
  })

  if (error || !data.user) redirect('/login?error=' + encodeURIComponent(error?.message || 'Could not sign in'))
  await redirectAfterAuth(data.user.id)
}

export async function signup(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    captcha_token: formData.get('captcha_token') || undefined,
  })

  if (!parsed.success) redirect('/login?error=' + encodeURIComponent('Enter a valid email and an 8+ character password'))
  requireCaptcha(parsed.data.captcha_token)

  const supabase = await createClient()
  const emailRedirectTo = await getSiteUrl('/auth/callback')
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.email.split('@')[0] },
      emailRedirectTo,
      ...(parsed.data.captcha_token ? { captchaToken: parsed.data.captcha_token } : {}),
    },
  })

  if (error) redirect('/login?error=' + encodeURIComponent(error.message))
  if (data.session && data.user) await redirectAfterAuth(data.user.id)

  redirect('/login?message=' + encodeURIComponent('Check your email to confirm your account'))
}
