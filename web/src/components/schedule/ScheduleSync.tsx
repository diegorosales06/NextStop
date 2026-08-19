'use client'

/**
 * Owns all schedule↔DB persistence for a signed-in user. Mounted once in the
 * root layout; renders nothing.
 *
 *  - On sign-in (or an existing session at load): reconcile once.
 *      • local schedule non-empty → push it to the DB (the just-built list wins).
 *      • local schedule empty      → pull the saved schedule down.
 *  - While signed in: autosave — debounce-push local changes to the DB.
 *
 * The anonymous editor is untouched by this; it only ever reads/writes
 * localStorage. This component is the entire "sign in = save your data" story.
 */
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getScheduleCourses, subscribeToSchedule } from '@/lib/schedule/store'
import { pushLocalToDb, pullDbToLocal } from '@/lib/schedule/sync'

export function ScheduleSync() {
  const reconciledFor = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()

    async function reconcile(userId: string) {
      if (reconciledFor.current === userId) return
      reconciledFor.current = userId
      if (getScheduleCourses().length > 0) {
        await pushLocalToDb(userId)
      } else {
        await pullDbToLocal()
      }
    }

    let userId: string | null = null

    // Existing session at first load.
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        userId = data.user.id
        void reconcile(userId)
      }
    })

    // Sign-in / sign-out during the session.
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      userId = session?.user?.id ?? null
      if (userId) void reconcile(userId)
      else reconciledFor.current = null
    })

    // Autosave: debounce-push local edits while signed in.
    const unsubStore = subscribeToSchedule(() => {
      if (!userId || reconciledFor.current !== userId) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const id = userId
      saveTimer.current = setTimeout(() => void pushLocalToDb(id), 800)
    })

    return () => {
      authSub.subscription.unsubscribe()
      unsubStore()
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  return null
}
