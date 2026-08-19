'use client'

/** The interactive schedule editor. Works fully signed out (localStorage);
 *  when signed in, ScheduleSync mirrors it to the DB in the background. */
import Link from 'next/link'
import {
  useScheduleCourses,
  removeCourse,
  setCourseStatus,
  clearSchedule,
  courseIdsCsv,
  type CourseStatus,
} from '@/lib/schedule/store'
import { CourseSearch } from './CourseSearch'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'

const STATUS_LABEL: Record<CourseStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  planned: 'Planned',
}

export function ScheduleEditor({ signedIn }: { signedIn: boolean }) {
  const courses = useScheduleCourses()
  const csv = courseIdsCsv(courses)

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 20 }}>
        <CourseSearch />
      </div>

      {courses.length === 0 ? (
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
            No courses yet
          </div>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Search above and add the courses you&apos;ve taken or plan to take.
            We&apos;ll rank the UC and CSU majors you&apos;re closest to — no
            account needed.
          </p>
        </div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {courses.map((c) => (
              <li
                key={c.id}
                className="bg-surface border-app"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  border: '1px solid',
                  borderRadius: 8,
                  marginBottom: 8,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {c.label}
                  </div>
                  <div
                    className="text-muted"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.sub}
                  </div>
                </div>

                <select
                  value={c.status}
                  onChange={(e) => setCourseStatus(c.id, e.target.value as CourseStatus)}
                  className="bg-surface-2 border-app text-app"
                  style={{
                    height: 30,
                    padding: '0 8px',
                    borderRadius: 6,
                    border: '1px solid',
                    fontFamily: 'inherit',
                    fontSize: 12,
                  }}
                >
                  {(Object.keys(STATUS_LABEL) as CourseStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => removeCourse(c.id)}
                  aria-label={`Remove ${c.label}`}
                  className="text-muted"
                  style={{
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                    fontSize: 18,
                    lineHeight: 1,
                    padding: '0 4px',
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 16,
            }}
          >
            <button
              onClick={() => clearSchedule()}
              className="text-muted"
              style={{
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Clear all
            </button>

            <Link
              href={`/majors?courses=${csv}`}
              style={{
                display: 'inline-block',
                padding: '10px 18px',
                borderRadius: 8,
                background: 'var(--accent)',
                color: 'white',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              See matching majors ({courses.length}) →
            </Link>
          </div>
        </>
      )}

      {/* Save state */}
      <div style={{ marginTop: 28 }}>
        {signedIn ? (
          <div
            className="bg-success-soft text-success"
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            ✓ Saved to your account
          </div>
        ) : (
          <div
            className="bg-surface border-app"
            style={{
              padding: 16,
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
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                Save this schedule
              </div>
              <div className="text-muted" style={{ fontSize: 13 }}>
                Sign in to keep it across devices. Your current list carries over.
              </div>
            </div>
            <GoogleSignInButton />
          </div>
        )}
      </div>
    </div>
  )
}
