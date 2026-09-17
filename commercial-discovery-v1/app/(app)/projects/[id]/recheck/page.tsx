import { createClient } from '@/lib/supabase/server'

export default async function RecheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: benchmarks } = await supabase.from('benchmarks').select('id,benchmark_type,status,version,started_at,completed_at,parent_benchmark_id').eq('project_id', id).order('created_at', { ascending: false })
  return <div className="project-page"><section className="page-header compact"><div><div className="eyebrow">DID ANYTHING CHANGE?</div><h1>Recheck</h1><p>A verified implementation and a changed AI result are separate facts. Rechecks preserve the frozen question panel and never imply causality automatically.</p></div></section><div className="timeline">{benchmarks?.map((benchmark) => <article key={benchmark.id}><span>{benchmark.benchmark_type} v{benchmark.version}</span><strong>{benchmark.status}</strong><small>{benchmark.completed_at ? new Date(benchmark.completed_at).toLocaleString() : 'Not completed'}</small></article>)}</div>{!benchmarks?.length && <div className="empty-state"><h2>No benchmark yet.</h2><p>The first baseline will create the frozen comparison point for future rechecks.</p></div>}</div>
}
