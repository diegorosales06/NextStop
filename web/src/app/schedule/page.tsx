import { redirect } from 'next/navigation'
import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'

export default async function SchedulePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const { data: schedules, error } = await supabase
    .from('schedules')
    .select('id, name, is_primary, notes, updated_at')
    .order('updated_at', { ascending: false })

  return (
    <>
      <Header active="schedule" />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 40px' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
          Your schedule
        </h1>
        <p className="text-muted" style={{ margin: '4px 0 24px', fontSize: 13 }}>
          Signed in as {user.email}
        </p>

        {error && (
          <div style={{ padding: 12, background: '#fee', borderRadius: 6, marginBottom: 16 }}>
            Query error: {error.message}
          </div>
        )}

        {(!schedules || schedules.length === 0) ? (
          <div
            className="bg-surface border-app"
            style={{
              padding: 32,
              border: '1px dashed',
              borderRadius: 12,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
              No schedules yet
            </div>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 20 }}>
              A schedule is a named set of courses you&apos;ve taken or plan to take.
              Create one to see which majors you&apos;re closest to.
            </p>
            <button
              style={{
                padding: '10px 16px',
                borderRadius: 6,
                background: 'var(--accent)',
                color: 'white',
                border: 0,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Create schedule
            </button>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
              (Not wired up yet — this is a scaffold. See src/app/schedule/page.tsx.)
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {schedules.map((s) => (
              <li
                key={s.id}
                className="bg-surface border-app"
                style={{
                  padding: 16,
                  border: '1px solid',
                  borderRadius: 8,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 500 }}>{s.name}</div>
                {s.is_primary && (
                  <span className="text-accent" style={{ fontSize: 11 }}>Primary</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
