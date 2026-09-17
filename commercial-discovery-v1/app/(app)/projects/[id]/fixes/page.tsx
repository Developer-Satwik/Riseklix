import { createClient } from '@/lib/supabase/server'

export default async function FixesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: fixes } = await supabase.from('blueprints').select('id,title,objective,status,target_url,suggested_h1,evidence_required,acceptance_criteria').eq('project_id', id).order('created_at')
  return <div className="project-page"><section className="page-header compact"><div><div className="eyebrow">WHAT SHOULD WE CHANGE?</div><h1>Fixes</h1><p>Only evidence-supported actions become blueprints. Every blueprint can later route to DIY, an expert, or managed execution without changing the scope.</p></div></section><div className="fix-grid">{fixes?.map((fix) => <article key={fix.id}><span>{fix.status}</span><h2>{fix.title}</h2><p>{fix.objective}</p><dl><div><dt>Target</dt><dd>{fix.target_url || 'To be defined'}</dd></div><div><dt>Suggested H1</dt><dd>{fix.suggested_h1 || 'To be defined'}</dd></div></dl></article>)}</div>{!fixes?.length && <div className="empty-state"><h2>No fixes justified yet.</h2><p>That is intentional. Riseklix should not manufacture work before the diagnostic layer supports it.</p></div>}</div>
}
