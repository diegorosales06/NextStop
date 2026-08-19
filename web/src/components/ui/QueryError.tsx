import type { CSSProperties } from 'react'

/** Standard error box for a failed Supabase query. Renders nothing when there's
 *  no error. Uses the danger design tokens so it reads correctly in dark mode
 *  (the previous inline `#fee` stayed pink on a dark background). */
export function QueryError({
  error,
  style,
}: {
  error: { message: string } | null | undefined
  style?: CSSProperties
}) {
  if (!error) return null
  return (
    <div
      className="bg-danger-soft text-danger border-danger"
      style={{
        padding: 12,
        border: '1px solid',
        borderRadius: 6,
        marginBottom: 16,
        fontSize: 13,
        ...style,
      }}
    >
      Query error: {error.message}
    </div>
  )
}
