'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSiteUrl } from '@/lib/site-url'

const schema = z.object({
  email: z.string().email(),
  captcha_token: z.string().optional(),
})

export async function requestPasswordReset(formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    captcha_token: formData.get('captcha_token') || undefined,
  })

  if (!parsed.success) redirect('/forgot-password?error=' + encodeURIComponent('Enter a valid email address'))

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  if (siteKey && !parsed.data.captcha_token) {
    redirect('/forgot-password?error=' + encodeURIComponent('Complete the security check and try again'))
  }

  const supabase = await createClient()
  const redirectTo = await getSiteUrl('/auth/callback?next=/update-password')
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo,
    captchaToken: parsed.data.captcha_token,
  })

  if (error) redirect('/forgot-password?error=' + encodeURIComponent(error.message))

  redirect('/forgot-password?message=' + encodeURIComponent('If an account exists for that email, a recovery link has been sent.'))
}
