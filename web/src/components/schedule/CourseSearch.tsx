'use client'

/** Course autocomplete. Pick a community college, type to search its catalog,
 *  click a result to add it to the schedule. Reads `courses` directly via the
 *  browser client (public-read RLS), so it works signed out. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MVP_SENDING_IDS } from '@/lib/mvp'
import { addCourse, useScheduleCourses } from '@/lib/schedule/store'
import { toLocalCourse } from '@/lib/schedule/format'

type Result = {
  id: number
  prefix: string
  course_number: string
  title: string
  institution_id: number
  min_units: number | null
  max_units: number | null
}

export function CourseSearch() {
  const [institutionId, setInstitutionId] = useState<number>(MVP_SENDING_IDS[0].id)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const inSchedule = useScheduleCourses()
  const addedIds = useMemo(() => new Set(inSchedule.map((c) => c.id)), [inSchedule])

  // Debounced fetch on query / institution change.
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    const handle = setTimeout(async () => {
      setLoading(true)
      const safe = query.trim().replace(/[,()*%]/g, ' ').trim()
      let req = supabase
        .from('courses')
        .select('id, prefix, course_number, title, institution_id, min_units, max_units')
        .eq('institution_id', institutionId)
        .order('prefix', { ascending: true })
        .order('course_number', { ascending: true })
        .limit(25)
      if (safe) {
        req = req.or(
          `prefix.ilike.%${safe}%,course_number.ilike.%${safe}%,title.ilike.%${safe}%`,
        )
      }
      const { data, error } = await req
      if (cancelled) return
      if (error) console.error('[course search]', error.message)
      setResults(data ?? [])
      setLoading(false)
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, institutionId])

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={institutionId}
          onChange={(e) => setInstitutionId(Number(e.target.value))}
          className="bg-surface border-strong text-app"
          style={{
            height: 40,
            padding: '0 10px',
            borderRadius: 8,
            border: '1px solid',
            fontFamily: 'inherit',
            fontSize: 13,
            maxWidth: 180,
          }}
        >
          {MVP_SENDING_IDS.map((cc) => (
            <option key={cc.id} value={cc.id}>
              {cc.name}
            </option>
          ))}
        </select>

        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search courses — e.g. MATH 280, or “calculus”"
          className="bg-surface border-strong text-app"
          style={{
            flex: 1,
            height: 40,
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid',
            fontFamily: 'inherit',
            fontSize: 14,
            outline: 'none',
          }}
        />
      </div>

      {open && (
        <div
          className="bg-surface border-strong"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: 46,
            left: 0,
            right: 0,
            border: '1px solid',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            maxHeight: 340,
            overflowY: 'auto',
          }}
        >
          {loading && (
            <div className="text-muted" style={{ padding: 14, fontSize: 13 }}>
              Searching…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="text-muted" style={{ padding: 14, fontSize: 13 }}>
              No courses found. (Only loaded catalogs appear — the data set is
              still filling in.)
            </div>
          )}
          {!loading &&
            results.map((r) => {
              const added = addedIds.has(r.id)
              const units =
                r.min_units != null
                  ? r.min_units === r.max_units || r.max_units == null
                    ? `${r.min_units} units`
                    : `${r.min_units}–${r.max_units} units`
                  : null
              return (
                <button
                  key={r.id}
                  disabled={added}
                  onClick={() => {
                    addCourse(toLocalCourse(r))
                    setQuery('')
                    setResults([])
                  }}
                  className="border-app"
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'baseline',
                    gap: 10,
                    padding: '10px 14px',
                    background: 'transparent',
                    border: 0,
                    borderBottom: '1px solid',
                    textAlign: 'left',
                    cursor: added ? 'default' : 'pointer',
                    color: 'inherit',
                    fontFamily: 'inherit',
                    opacity: added ? 0.55 : 1,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      fontWeight: 600,
                      minWidth: 96,
                    }}
                  >
                    {r.prefix} {r.course_number}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{r.title}</span>
                  {units && (
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {units}
                    </span>
                  )}
                  <span
                    className={added ? 'text-muted' : 'text-accent'}
                    style={{ fontSize: 12, fontWeight: 600, minWidth: 44, textAlign: 'right' }}
                  >
                    {added ? 'Added' : '+ Add'}
                  </span>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}
