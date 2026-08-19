import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'
import { MVP_YEAR_ID } from '@/lib/mvp'
import { CoursesUrlSync } from '@/components/schedule/CoursesUrlSync'
import { QueryError } from '@/components/ui/QueryError'
import { parseCourseIds, coursesParam, coursesSuffix } from '@/lib/courses/params'
import Link from 'next/link'

/** MVP umbrella majors. Each school's raw major_name is a school-specific label
 *  (e.g. "CSE: Computer Science B.S.", "Mathematics/Computer Science B.S."), so
 *  we lump them into 3 fixed buckets by keyword. Each category is an independent
 *  predicate — a name matching two terms (e.g. "Electrical and Computer
 *  Engineering") intentionally appears under both umbrellas. */
const MAJOR_CATEGORIES = [
  {
    key: 'computer-science',
    label: 'Computer Science',
    matches: (n: string) => n.toLowerCase().includes('computer science'),
  },
  {
    key: 'electrical-engineering',
    label: 'Electrical Engineering',
    matches: (n: string) => n.toLowerCase().includes('electrical'),
  },
  {
    key: 'computer-engineering',
    label: 'Computer Engineering',
    matches: (n: string) => n.toLowerCase().includes('computer engineering'),
  },
] as const

type MajorCategory = (typeof MAJOR_CATEGORIES)[number]

/** Two-step "matching majors":
 *  1. Pick an umbrella major (Computer Science / Electrical / Computer Eng.).
 *  2. See every receiving school offering a program under that umbrella, ranked
 *     against your coursework so far.
 *
 *  Courses come from ?courses= (a comma-separated list of course IDs the local
 *  schedule reflects via CoursesUrlSync). Without a schedule the ranking still
 *  renders — every school at 0% — so the page is browsable signed-out. */
export default async function MajorsPage({
  searchParams,
}: {
  searchParams: Promise<{ courses?: string; major?: string }>
}) {
  const supabase = await createClient()
  const { courses: coursesRaw, major: majorParam } = await searchParams
  const courseIds = parseCourseIds(coursesRaw)
  const suffix = coursesSuffix(courseIds)
  // Selection is validated against the static category list, not a DB query, so
  // a valid ?major= deep link can't be knocked back to the picker by a query error.
  const selectedCategory = MAJOR_CATEGORIES.find((c) => c.key === majorParam) ?? null

  return (
    <>
      <CoursesUrlSync />
      <Header active="majors" />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 40px' }}>
        {selectedCategory ? (
          <SchoolsView
            supabase={supabase}
            category={selectedCategory}
            courseIds={courseIds}
          />
        ) : (
          <PickerView supabase={supabase} coursesSuffix={suffix} />
        )}
      </main>
    </>
  )
}

/** Step 1 — choose an umbrella major. Three fixed cards; the per-category school
 *  count is best-effort (omitted if the count query fails). */
async function PickerView({
  supabase,
  coursesSuffix,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  coursesSuffix: string
}) {
  const { data: agRows } = await supabase
    .from('agreements')
    .select('major_name, receiving_id')
    .eq('category', 'Major')
    .eq('year_id', MVP_YEAR_ID)

  const categories = MAJOR_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    schoolCount: new Set(
      (agRows ?? []).filter((a) => c.matches(a.major_name)).map((a) => a.receiving_id),
    ).size,
  }))

  return (
    <>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
        Choose a major
      </h1>
      <p className="text-muted" style={{ margin: '4px 0 24px', fontSize: 13 }}>
        Pick a major to see which schools your coursework matches so far.
      </p>

      <div
        className="bg-surface border-app"
        style={{ border: '1px solid', borderRadius: 12, overflow: 'hidden' }}
      >
        {categories.map((c) => (
          <Link
            key={c.key}
            href={`/majors?major=${c.key}${coursesSuffix}`}
            className="border-app"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 20,
              padding: '16px 20px',
              borderBottom: '1px solid',
              textDecoration: 'none',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{c.label}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {c.schoolCount} school{c.schoolCount === 1 ? '' : 's'}
              </div>
            </div>
            <span className="text-accent" style={{ fontSize: 13, fontWeight: 500 }}>
              View schools →
            </span>
          </Link>
        ))}
      </div>
    </>
  )
}

/** Step 2 — schools with a program under the chosen umbrella, ranked against the
 *  coursework. One row per receiving school (its best-matching program). */
async function SchoolsView({
  supabase,
  category,
  courseIds,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  category: MajorCategory
  courseIds: number[]
}) {
  // Raise p_limit so the client-side category filter can't be truncated behind
  // higher-ranked rows of other majors. (At full roster scale ~900 agreements
  // this could still clip; the durable fix is a keyword filter on the RPC.)
  const { data: rows, error } = await supabase.rpc('rank_agreements_for_courses', {
    p_course_ids: courseIds,
    p_year_id: MVP_YEAR_ID,
    p_limit: 500,
  })

  // One row per (receiving school, program). The same program repeats once per
  // sending CC — the user's courses belong to one CC so the rest are 0% noise —
  // so we collapse only those repeats, keeping every distinct major under the
  // umbrella visible.
  const bestByProgram = new Map<string, NonNullable<typeof rows>[number]>()
  for (const r of rows ?? []) {
    if (!category.matches(r.major_name)) continue
    const key = `${r.receiving_id}::${r.major_name}`
    const prev = bestByProgram.get(key)
    if (!prev || (r.completion_pct ?? 0) > (prev.completion_pct ?? 0)) {
      bestByProgram.set(key, r)
    }
  }
  const schools = [...bestByProgram.values()].sort(
    (a, b) =>
      (b.completion_pct ?? 0) - (a.completion_pct ?? 0) ||
      a.receiving_name.localeCompare(b.receiving_name) ||
      a.major_name.localeCompare(b.major_name),
  )

  return (
    <>
      <Link
        href={courseIds.length ? `/majors?${coursesParam(courseIds)}` : '/majors'}
        className="text-accent"
        style={{ fontSize: 13, fontWeight: 500 }}
      >
        ← Change major
      </Link>
      <h1 style={{ margin: '12px 0 0', fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
        {category.label}
      </h1>
      <p className="text-muted" style={{ margin: '4px 0 24px', fontSize: 13 }}>
        {courseIds.length
          ? `Schools ranked against ${courseIds.length} course${courseIds.length === 1 ? '' : 's'}.`
          : 'No courses yet — showing every school at 0%. Add courses to your schedule to rank them.'}
      </p>

      <QueryError error={error} />

      <div
        className="bg-surface border-app"
        style={{ border: '1px solid', borderRadius: 12, overflow: 'hidden' }}
      >
        {schools.map((r) => (
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
                {r.receiving_name}
              </div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {r.major_name}
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
        {schools.length === 0 && !error && (
          <div className="text-muted" style={{ padding: 32, textAlign: 'center', fontSize: 13 }}>
            No schools offer a program under this major in the loaded data yet.
          </div>
        )}
      </div>
    </>
  )
}
