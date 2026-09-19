'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { resumeBenchmarkCollection } from '@/app/(app)/projects/[id]/collection-actions'

export function BenchmarkCollectionResumer({
  projectId,
  benchmarkId,
  active,
  intervalMs = 20000,
}: {
  projectId: string
  benchmarkId: string
  active: boolean
  intervalMs?: number
}) {
  const router = useRouter()
  const inFlight = useRef(false)

  useEffect(() => {
    if (!active) return

    let cancelled = false

    const resume = async () => {
      if (inFlight.current || cancelled) return
      inFlight.current = true
      try {
        const result = await resumeBenchmarkCollection(projectId, benchmarkId)
        if (!cancelled) {
          router.refresh()
          if (result.terminal) cancelled = true
        }
      } finally {
        inFlight.current = false
      }
    }

    const first = window.setTimeout(() => void resume(), 1200)
    const timer = window.setInterval(() => void resume(), intervalMs)

    return () => {
      cancelled = true
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [active, benchmarkId, intervalMs, projectId, router])

  return null
}
