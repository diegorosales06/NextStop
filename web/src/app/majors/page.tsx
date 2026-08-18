import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'
import { MVP_YEAR_ID } from '@/lib/mvp'
import Link from 'next/link'

/** Ranked majors — public. Without a schedule, we call the engine with an
 *  empty course list and show every major at 0% so you can browse.
 *  With a ?courses= comma-separated list of course IDs (from URL), we rank
 *  against those. Once we wire the schedule editor, this defaults to the
 *  primary schedule for signed-in users. */
export default async function MajorsPage({
  searchParams,
}: {
  searchParams: Promise<{ courses?: string }>
}) {
  const supabase = await createClient()
  const { courses: coursesParam } = await searchParams
  const courseIds = coursesParam
    ? coursesParam.split(',').map(Number).filter(Boolean)
    : []

  const { data: rows, error } = await supabase.rpc('rank_agreements_for_courses', {
    p_course_ids: courseIds,
    p_year_id: MVP_YEAR_ID,
    p_limit: 50,
  })

  return (
    <>
      <Header active="majors" />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 40px' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
          Matching majors
        </h1>
        <p className="text-muted" style={{ margin: '4px 0 24px', fontSize: 13 }}>
          {courseIds.length
            ? `Ranked against ${courseIds.length} course${courseIds.length === 1 ? '' : 's'}.`
            : 'No courses yet — showing every major at 0%. Add courses to your schedule to rank them.'}
        </p>

        {error && (
          <div style={{ padding: 12, background: '#fee', borderRadius: 6, marginBottom: 16 }}>
            Query error: {error.message}
          </div>
        )}

        <div
          className="bg-surface border-app"
          style={{
            border: '1px solid',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {(rows ?? []).map((r) => (
            <div
              key={r.agreement_id}
              className="border-app"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 220px 90px',
                gap: 20,
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: '1px solid',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                  {r.major_name}
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {r.receiving_name}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span className="text-muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {r.satisfied_entries} of {r.total_entries} requirements
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {r.completion_pct ?? 0}%
                  </span>
                </div>
                <div className="bg-track" style={{ height: 6, borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${r.completion_pct ?? 0}%`,
                      background: 'var(--accent)',
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>

              <Link
                href={`/majors/${r.agreement_id}`}
                className="text-accent"
                style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}
              >
                Details →
              </Link>
            </div>
          ))}
          {(!rows || rows.length === 0) && !error && (
            <div className="text-muted" style={{ padding: 32, textAlign: 'center', fontSize: 13 }}>
              No agreements matched. Make sure metadata + articulations are loaded
              (run <code>python main.py load-institutions</code> etc.).
            </div>
          )}
        </div>
      </main>
    </>
  )
}
