'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function ResearchJobWatcher({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => router.refresh(), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs, router])

  return null
}
