import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'

/** Saved majors — the one genuinely account-bound page (saving is the point).
 *  Anonymous users see a sign-in prompt instead of a silent redirect. */
export default async function SavedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

        {!user ? (
          <div
            className="bg-surface border-app"
            style={{
              padding: 28,
              border: '1px solid',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
                Sign in to save majors
              </div>
              <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                Browsing and building a schedule need no account — saving majors
                to come back to does.
              </p>
            </div>
            <GoogleSignInButton />
          </div>
        ) : (
          <SavedList />
        )}
      </main>
    </>
  )
}

async function SavedList() {
  const supabase = await createClient()
  const { data: saved } = await supabase
    .from('saved_agreements')
    .select('id, note, agreement_id')

  if (!saved || saved.length === 0) {
    return (
      <div className="text-muted" style={{ fontSize: 13 }}>
        No saved majors yet. Star one from the major detail page.
      </div>
    )
  }

  // Second hop for major names — the hand-written types don't model FK embeds.
  const { data: agreements } = await supabase
    .from('agreements')
    .select('id, major_name, receiving_id')
    .in('id', saved.map((s) => s.agreement_id))
  const nameById = new Map((agreements ?? []).map((a) => [a.id, a.major_name]))

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {saved.map((s) => (
        <li key={s.id} style={{ padding: 12 }}>
          {nameById.get(s.agreement_id) ?? `Agreement #${s.agreement_id}`}
        </li>
      ))}
    </ul>
  )
}
