'use client'

/** Reflects the local (anonymous) schedule into the `?courses=` query param so
 *  the server-rendered ranking on /majors and /majors/[id] matches whatever the
 *  user built in the editor — signed in or not. Renders nothing.
 *
 *  Reads window.location directly (rather than useSearchParams) to avoid the
 *  Suspense requirement; these routes are already dynamic. */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useScheduleCourses, courseIdsCsv } from '@/lib/schedule/store'

export function CoursesUrlSync() {
  const router = useRouter()
  const courses = useScheduleCourses()

  useEffect(() => {
    const csv = courseIdsCsv(courses)
    if (!csv) return // nothing local — leave any explicit ?courses= alone
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('courses') === csv) return
    sp.set('courses', csv)
    router.replace(`${window.location.pathname}?${sp.toString()}`)
  }, [courses, router])

  return null
}
