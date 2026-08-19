/** Shared course → display helpers, used by both the search UI (adding a
 *  course) and the DB pull (restoring a saved schedule) so a course looks
 *  identical however it entered the store. */
import { MVP_SENDING_IDS, MVP_RECEIVING_IDS } from '@/lib/mvp'
import type { LocalScheduleCourse } from '@/lib/schedule/store'

const NAMES = new Map<number, string>(
  [...MVP_SENDING_IDS, ...MVP_RECEIVING_IDS].map((i) => [i.id, i.name]),
)

export function institutionName(id: number): string {
  return NAMES.get(id) ?? `Institution ${id}`
}

type CourseRowLike = {
  id: number
  prefix: string
  course_number: string
  title: string
  institution_id: number
}

export function toLocalCourse(
  row: CourseRowLike,
  status: LocalScheduleCourse['status'] = 'completed',
): LocalScheduleCourse {
  return {
    id: row.id,
    status,
    label: `${row.prefix} ${row.course_number}`.trim(),
    sub: `${row.title} · ${institutionName(row.institution_id)}`,
  }
}
