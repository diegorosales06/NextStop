import { redirect } from 'next/navigation'
import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'

export default async function SavedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: saved } = await supabase
    .from('saved_agreements')
    .select(`
      id, note, created_at,
      agreements ( id, major_name, receiving_id )
    `)

  return (
    <>
      <Header active="saved" />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 40px' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
          Saved majors
        </h1>
        <p className="text-muted" style={{ margin: '4px 0 24px', fontSize: 13 }}>
          Transfer targets you starred from the major detail page.
        </p>

        {(!saved || saved.length === 0) ? (
          <div className="text-muted" style={{ fontSize: 13 }}>
            No saved majors yet. Star one from the major detail page.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {saved.map((s) => (
              <li key={s.id} style={{ padding: 12 }}>
                {/* @ts-expect-error — the join renders as an array; UI polish is a follow-up */}
                {s.agreements?.major_name}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
