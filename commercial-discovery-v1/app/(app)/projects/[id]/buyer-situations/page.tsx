import { createClient } from '@/lib/supabase/server'

export default async function BuyerSituationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: intents } = await supabase.from('buyer_intents').select('id,title,buyer,job_to_be_done,provenance,priority,status,commercial_model,geography').eq('project_id', id).order('created_at')

  return <div className="project-page"><section className="page-header compact"><div><div className="eyebrow">WHERE SHOULD WE BE CONSIDERED?</div><h1>Buyer Situations</h1><p>Riseklix models the commercial situation first. Prompt expressions and competitor sets sit underneath each intent instead of becoming the product itself.</p></div></section><div className="intent-list">{intents?.map((intent) => <article key={intent.id}><div className="intent-meta"><span>{intent.provenance}</span><span>{intent.priority}</span><span>{intent.status}</span></div><h2>{intent.title}</h2><p>{intent.job_to_be_done}</p><footer><span>{intent.buyer || 'Buyer not set'}</span><span>{intent.commercial_model || 'Commercial model not set'}</span></footer></article>)}</div>{!intents?.length && <div className="empty-state"><h2>No buyer situations yet.</h2><p>They will be generated only after the company profile is reviewed and approved.</p></div>}</div>
}
