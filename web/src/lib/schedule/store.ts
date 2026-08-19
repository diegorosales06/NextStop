/**
 * Anonymous schedule store — the live source of truth for the schedule editor,
 * signed in or not. A schedule is just a list of courses held in localStorage;
 * the requirement engine only ever needs the course IDs (see `courseIdsCsv`).
 *
 * Signing in doesn't change how the editor reads/writes — it only adds a
 * background push/pull to the DB (see components/schedule/ScheduleSync.tsx).
 *
 * Built on useSyncExternalStore so React stays in sync across components and
 * across browser tabs (via the `storage` event).
 */
import { useSyncExternalStore } from 'react'

export type CourseStatus = 'completed' | 'in_progress' | 'planned'

export type LocalScheduleCourse = {
  id: number // courses.id
  status: CourseStatus
  label: string // "MATH 280"
  sub: string // "Calculus III · Mt. San Antonio College"
}

const KEY = 'nextstop.schedule.v1'
const EMPTY: LocalScheduleCourse[] = []

type Listener = () => void
const listeners = new Set<Listener>()

// getSnapshot must return a stable reference until the data actually changes,
// or useSyncExternalStore loops. `cache` is that reference; it's only replaced
// on a real mutation (write) or a cross-tab storage event.
let cache: LocalScheduleCourse[] | null = null
let storageBound = false

function readFromStorage(): LocalScheduleCourse[] {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as { courses?: unknown }
    if (!Array.isArray(parsed?.courses)) return EMPTY
    return parsed.courses as LocalScheduleCourse[]
  } catch {
    return EMPTY
  }
}

function snapshot(): LocalScheduleCourse[] {
  if (cache === null) cache = readFromStorage()
  return cache
}

function write(next: LocalScheduleCourse[]) {
  cache = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ courses: next }))
    } catch {
      // Quota / private-mode — keep the in-memory copy so the session works.
    }
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  if (!storageBound && typeof window !== 'undefined') {
    storageBound = true
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return
      cache = null // force a re-read on next snapshot()
      listeners.forEach((l) => l())
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

// ---- Reads --------------------------------------------------------------

/** Non-hook read, for imperative code (e.g. the DB sync). */
export function getScheduleCourses(): LocalScheduleCourse[] {
  return snapshot()
}

/** Non-hook subscription, for imperative code (e.g. autosave). Returns an
 *  unsubscribe function. */
export function subscribeToSchedule(listener: () => void): () => void {
  return subscribe(listener)
}

/** React hook — re-renders when the schedule changes. */
export function useScheduleCourses(): LocalScheduleCourse[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY)
}

export function courseIdsCsv(courses: LocalScheduleCourse[]): string {
  return courses.map((c) => c.id).join(',')
}

// ---- Mutations ----------------------------------------------------------

export function addCourse(course: LocalScheduleCourse) {
  const current = snapshot()
  if (current.some((c) => c.id === course.id)) return
  write([...current, course])
}

export function removeCourse(id: number) {
  write(snapshot().filter((c) => c.id !== id))
}

export function setCourseStatus(id: number, status: CourseStatus) {
  write(snapshot().map((c) => (c.id === id ? { ...c, status } : c)))
}

export function clearSchedule() {
  write([])
}

/** Wholesale replace — used when pulling a saved schedule from the DB. */
export function replaceSchedule(courses: LocalScheduleCourse[]) {
  write(courses)
}
