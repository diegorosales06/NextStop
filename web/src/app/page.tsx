import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'

/** Landing page — public. Renders whether or not you're signed in. */
export default async function LandingPage() {
  const supabase = await createClient()
  const { count: agreementCount } = await supabase
    .from('agreements')
    .select('*', { count: 'exact', head: true })

  return (
    <>
      <Header />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 40px 32px' }}>
        <div
          className="text-accent"
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
          }}
        >
          For California community college students
        </div>

        <h1
          style={{
            margin: '16px 0 12px',
            fontSize: 40,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          Plan your transfer. See exactly what to take.
        </h1>

        <p
          className="text-muted"
          style={{
            margin: '0 0 32px',
            fontSize: 16,
            maxWidth: 620,
            lineHeight: 1.55,
          }}
        >
          Add your community college courses. See which UC and CSU majors you&apos;re closest to.
          Get an exact list of what&apos;s left — from your CC or another that offers it.
        </p>

        <div
          className="bg-surface border-app"
          style={{
            border: '1px solid',
            borderRadius: 12,
            padding: 20,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
        >
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Coming soon: add courses right from here. For now, sign in to start building a schedule.
          </div>
          <a
            href="/schedule"
            style={{
              display: 'inline-block',
              padding: '10px 16px',
              borderRadius: 6,
              background: 'var(--accent)',
              color: 'white',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Get started →
          </a>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 20,
            marginTop: 40,
          }}
        >
          {[
            { n: '1', title: 'Enter your courses', body: 'Search your CC catalog. Add what you\'ve taken and what you plan to take.' },
            { n: '2', title: 'See matching majors', body: 'A ranked list of UC and CSU majors, ordered by how close your schedule gets you.' },
            { n: '3', title: 'Fill the gaps',      body: 'Every missing requirement shows exactly which CC courses will satisfy it.' },
          ].map((s) => (
            <div key={s.n}>
              <div
                className="bg-accent-soft text-accent"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 600,
                  fontSize: 13,
                  marginBottom: 10,
                }}
              >
                {s.n}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {s.title}
              </div>
              <div className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                {s.body}
              </div>
            </div>
          ))}
        </div>

        <footer
          className="text-muted border-app"
          style={{
            padding: '24px 0',
            marginTop: 32,
            borderTop: '1px solid',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <div>
            Data from assist.org · {agreementCount ?? '—'} agreements loaded
          </div>
          <div>Sign in required only to save schedules</div>
        </footer>
      </main>
    </>
  )
}
