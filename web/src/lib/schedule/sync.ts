/**
 * DB persistence for a signed-in user's schedule. This is the only place the
 * app writes schedules/schedule_courses — the editor itself only touches
 * localStorage (see store.ts). Called by components/schedule/ScheduleSync.tsx.
 *
 * Model: localStorage is the live working copy; the DB is the saved snapshot.
 *  - push: mirror the local schedule into a single primary "My schedule" row.
 *  - pull: hydrate localStorage from the saved schedule (fresh device / cleared
 *    browser). Only used when local is empty so we never clobber unsaved edits.
 */
import { createClient } from '@/lib/supabase/client'
import {
  getScheduleCourses,
  replaceSchedule,
  type LocalScheduleCourse,
} from '@/lib/schedule/store'
import { toLocalCourse } from '@/lib/schedule/format'

const SCHEDULE_NAME = 'My schedule'

/** Find the user's primary schedule id, creating it if absent. RLS scopes all
 *  of this to the current user, so no explicit user_id filter is needed on
 *  reads. */
async function ensureScheduleId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('schedules')
    .upsert(
      { user_id: userId, name: SCHEDULE_NAME, is_primary: true },
      { onConflict: 'user_id,name' },
    )
    .select('id')
    .single()

  if (error) {
    console.error('[schedule sync] ensureScheduleId failed:', error.message)
    return null
  }
  return data.id
}

/** Mirror the local schedule into the DB (delete-then-insert the course set). */
export async function pushLocalToDb(userId: string): Promise<void> {
  const courses = getScheduleCourses()
  const supabase = createClient()
  const scheduleId = await ensureScheduleId(supabase, userId)
  if (scheduleId === null) return

  const { error: delErr } = await supabase
    .from('schedule_courses')
    .delete()
    .eq('schedule_id', scheduleId)
  if (delErr) {
    console.error('[schedule sync] clear failed:', delErr.message)
    return
  }

  if (courses.length === 0) return

  const rows = courses.map((c) => ({
    schedule_id: scheduleId,
    course_id: c.id,
    status: c.status,
  }))
  const { error: insErr } = await supabase.from('schedule_courses').insert(rows)
  if (insErr) console.error('[schedule sync] insert failed:', insErr.message)
}

/** Hydrate localStorage from the saved schedule. Returns the restored courses
 *  (empty if the user has no saved schedule yet). */
export async function pullDbToLocal(): Promise<LocalScheduleCourse[]> {
  const supabase = createClient()

  const { data: schedule } = await supabase
    .from('schedules')
    .select('id')
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle()
  if (!schedule) return []

  const { data: rows, error } = await supabase
    .from('schedule_courses')
    .select('course_id, status')
    .eq('schedule_id', schedule.id)
  if (error || !rows || rows.length === 0) {
    if (error) console.error('[schedule sync] pull failed:', error.message)
    return []
  }

  // Second hop for display fields — the hand-written types don't model FK
  // embeds, so we join in JS rather than via `courses(...)`.
  const statusById = new Map(rows.map((r) => [r.course_id, r.status]))
  const { data: courseRows, error: cErr } = await supabase
    .from('courses')
    .select('id, prefix, course_number, title, institution_id')
    .in('id', [...statusById.keys()])
  if (cErr || !courseRows) {
    if (cErr) console.error('[schedule sync] course lookup failed:', cErr.message)
    return []
  }

  const courses = courseRows.map((c) =>
    toLocalCourse(c, statusById.get(c.id) ?? 'completed'),
  )

  replaceSchedule(courses)
  return courses
}
