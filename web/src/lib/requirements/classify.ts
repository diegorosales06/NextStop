/** The one owner of the "what counts as satisfied" rule for an ASSIST agreement.
 *
 *  An articulation entry is one of three things:
 *   - a prose "Requirement" note (no linked courses — verify with a counselor),
 *   - satisfied by the student's courses, or
 *   - not yet satisfied.
 *  Completion % is satisfied ÷ checkable, where checkable excludes notes.
 *
 *  Kept pure and framework-free so it's testable without rendering a page — the
 *  interface (rows in, buckets out) is the test surface. */
import type { Database } from '@/lib/database.types'

/** One row from the `check_agreement_for_courses` RPC. Derived from the generated
 *  Database type (rather than importing the unexported EntryRow) so a types
 *  regen can't silently break this. */
export type RequirementEntry =
  Database['public']['Functions']['check_agreement_for_courses']['Returns'][number]

/** Prose entries carry no linked courses; they're informational, not checkable. */
const NOTE_ENTRY_TYPE = 'Requirement'

export type ClassifiedRequirements = {
  satisfied: RequirementEntry[]
  unsatisfied: RequirementEntry[]
  /** Prose "Requirement" entries — excluded from the completion math. */
  notes: RequirementEntry[]
  /** Count of entries that count toward completion (satisfied + unsatisfied). */
  checkableCount: number
  /** 0–100, rounded. 0 when there's nothing checkable yet. */
  completionPct: number
}

export function classifyEntries(
  rows: readonly RequirementEntry[],
): ClassifiedRequirements {
  const satisfied: RequirementEntry[] = []
  const unsatisfied: RequirementEntry[] = []
  const notes: RequirementEntry[] = []

  for (const row of rows) {
    if (row.entry_type === NOTE_ENTRY_TYPE) notes.push(row)
    else if (row.satisfied) satisfied.push(row)
    else unsatisfied.push(row)
  }

  const checkableCount = satisfied.length + unsatisfied.length
  const completionPct = checkableCount
    ? Math.round((satisfied.length / checkableCount) * 100)
    : 0

  return { satisfied, unsatisfied, notes, checkableCount, completionPct }
}
