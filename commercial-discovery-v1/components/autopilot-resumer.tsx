'use client'

import { useEffect, useRef } from 'react'
import { resumeAutopilot } from '@/app/(app)/projects/[id]/overview/autopilot-actions'

export function AutopilotResumer({ projectId, active }: { projectId: string; active: boolean }) {
  const started = useRef(false)

  useEffect(() => {
    if (!active || started.current) return
    started.current = true
    void resumeAutopilot(projectId)
  }, [active, projectId])

  return null
}
