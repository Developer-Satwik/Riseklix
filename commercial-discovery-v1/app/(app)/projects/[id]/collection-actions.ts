'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const schema = z.object({
  project_id: z.string().uuid(),
  benchmark_id: z.string().uuid(),
})

async function edgeFunctionErrorMessage(error: unknown) {
  const candidate = error as { message?: string; context?: unknown } | null
  const fallback = candidate?.message || 'Observation collection could not resume'
  const context = candidate?.context

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string; message?: string }
      return payload?.message || payload?.error || fallback
    } catch {
      try {
        return (await context.clone().text()) || fallback
      } catch {
        return fallback
      }
    }
  }

  return fallback
}

export async function resumeBenchmarkCollection(projectId: string, benchmarkId: string) {
  const parsed = schema.safeParse({ project_id: projectId, benchmark_id: benchmarkId })
  if (!parsed.success) return { ok: false, terminal: true, message: 'Invalid benchmark request' }

  const supabase = await createClient()
  const { data: claims, error: authError } = await supabase.auth.getClaims()
  if (authError || typeof claims?.claims?.sub !== 'string') {
    return { ok: false, terminal: true, message: 'Authentication required' }
  }

  const { data: benchmark, error: benchmarkError } = await supabase
    .from('benchmarks')
    .select('id,status')
    .eq('id', parsed.data.benchmark_id)
    .eq('project_id', parsed.data.project_id)
    .single()

  if (benchmarkError || !benchmark) {
    return { ok: false, terminal: true, message: 'Benchmark could not be loaded' }
  }

  if (['complete', 'failed'].includes(benchmark.status)) {
    return { ok: true, terminal: true, status: benchmark.status }
  }

  const { data, error } = await supabase.functions.invoke('all-observation-runner', {
    body: {
      project_id: parsed.data.project_id,
      benchmark_id: parsed.data.benchmark_id,
    },
  })

  if (error) {
    return { ok: false, terminal: false, message: await edgeFunctionErrorMessage(error) }
  }

  if (data?.error) {
    return {
      ok: false,
      terminal: false,
      message: String(data.message || data.error),
      retryable: ['observation_budget_exceeded', 'ai_budget_exceeded'].includes(String(data.error)),
    }
  }

  return {
    ok: true,
    terminal: Boolean(data?.complete),
    pending: Boolean(data?.pending),
    message: String(data?.message || 'Observation collection is progressing.'),
  }
}
