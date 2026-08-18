import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export default async function MajorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ courses?: string }>
}) {
  const { id } = await params
  const agreementId = Number(id)
  if (!Number.isFinite(agreementId)) notFound()

  const { courses: coursesParam } = await searchParams
  const courseIds = coursesParam
    ? coursesParam.split(',').map(Number).filter(Boolean)
    : []

  const supabase = await createClient()

  const [{ data: agreement }, { data: entries, error }] = await Promise.all([
    supabase
      .from('agreements')
      .select('id, major_name, receiving_id, year_id, category, catalog_year')
      .eq('id', agreementId)
      .maybeSingle(),
    supabase.rpc('check_agreement_for_courses', {
      p_course_ids: courseIds,
      p_agreement_id: agreementId,
    }),
  ])

  if (!agreement) notFound()

  const { data: receiving } = await supabase
    .from('institutions')
    .select('name, code')
    .eq('id', agreement.receiving_id)
    .single()

  const rows = entries ?? []
  const satisfied = rows.filter((r) => r.satisfied && r.entry_type !== 'Requirement')
  const unsatisfied = rows.filter((r) => !r.satisfied && r.entry_type !== 'Requirement')
  const notes = rows.filter((r) => r.entry_type === 'Requirement')
  const totalCheckable = satisfied.length + unsatisfied.length
  const pct = totalCheckable ? Math.round((satisfied.length / totalCheckable) * 100) : 0

  return (
    <>
      <Header active="majors" />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 40px 40px' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
          <Link href="/majors" style={{ color: 'inherit' }}>Matching majors</Link>
          <span style={{ margin: '0 8px' }}>›</span>
          <span className="text-app">{receiving?.code ?? '—'} · {agreement.major_name}</span>
        </div>

        <div
          className="bg-surface border-app"
          style={{
            padding: 24,
            border: '1px solid',
            borderRadius: 12,
            marginBottom: 24,
          }}
        >
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 4 }}>
            {receiving?.name} · {agreement.catalog_year ?? ''}
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {agreement.major_name}
          </h1>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {pct}%
            </span>
            <span className="text-muted" style={{ fontSize: 14 }}>
              complete · {satisfied.length} of {totalCheckable} requirements satisfied
            </span>
          </div>
          <div className="bg-track" style={{ height: 8, borderRadius: 4, overflow: 'hidden', maxWidth: 480 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 4 }} />
          </div>
        </div>

        {error && (
          <div style={{ padding: 12, background: '#fee', borderRadius: 6, marginBottom: 16 }}>
            Query error: {error.message}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <section>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
              What you have <span className="text-muted" style={{ fontWeight: 400 }}>· {satisfied.length}</span>
            </h2>
            {satisfied.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>
                Nothing satisfied yet. Add courses to your schedule.
              </p>
            ) : (
              satisfied.map((r) => (
                <div
                  key={r.entry_id}
                  className="bg-success-soft"
                  style={{
                    padding: 12,
                    borderLeft: '3px solid var(--success)',
                    borderRadius: 6,
                    marginBottom: 6,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {r.receiving_summary ?? '(unnamed)'}
                </div>
              ))
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
              What you need <span className="text-muted" style={{ fontWeight: 400 }}>· {unsatisfied.length}</span>
            </h2>
            {unsatisfied.map((r) => (
              <div
                key={r.entry_id}
                className="bg-surface border-app"
                style={{
                  padding: 14,
                  border: '1px solid',
                  borderRadius: 6,
                  marginBottom: 6,
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>
                  {r.receiving_summary ?? '(unnamed)'}
                </div>
              </div>
            ))}
          </section>
        </div>

        {notes.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
              Verify with a counselor <span className="text-muted" style={{ fontWeight: 400 }}>· {notes.length}</span>
            </h2>
            <div
              style={{
                padding: 14,
                background: 'var(--info-soft)',
                border: '1px solid var(--info)',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              These requirements are described in prose in the ASSIST agreement — typically satisfied via IGETC or general education.
              <ul className="text-muted" style={{ marginTop: 8, paddingLeft: 20 }}>
                {notes.map((r) => (
                  <li key={r.entry_id}>Entry #{r.entry_id} ({r.entry_type})</li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>
    </>
  )
}
