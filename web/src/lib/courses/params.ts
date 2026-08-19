/** The seam between the `?courses=` URL param and a list of course IDs.
 *  Both major pages, the schedule editor, and CoursesUrlSync go through here so
 *  the param format has a single owner (and a single documented gotcha). */

/** Decode `?courses=12,34` → `[12, 34]`.
 *  `filter(Boolean)` drops empty segments and the id `0` — harmless because
 *  `courses.id` is a positive serial, and it keeps a stray `,,` from becoming NaN. */
export function parseCourseIds(param: string | undefined): number[] {
  return param ? param.split(',').map(Number).filter(Boolean) : []
}

/** The raw query value: `[12, 34]` → `"12,34"`. */
export function serializeCourseIds(ids: number[]): string {
  return ids.join(',')
}

/** `courses=12,34` (no leading `?`/`&`), or `''` when there are no courses.
 *  Use when the courses param is the first/only param on a link. */
export function coursesParam(ids: number[]): string {
  return ids.length ? `courses=${serializeCourseIds(ids)}` : ''
}

/** `&courses=12,34`, or `''` when empty. Use when appending to an existing
 *  query string (e.g. `/majors?major=cs${coursesSuffix(ids)}`). */
export function coursesSuffix(ids: number[]): string {
  const param = coursesParam(ids)
  return param ? `&${param}` : ''
}
