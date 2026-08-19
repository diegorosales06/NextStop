import { Header } from '@/components/Header'
import { createClient } from '@/lib/supabase/server'
import { ScheduleEditor } from '@/components/schedule/ScheduleEditor'

/** Schedule editor — public. Anonymous users build a schedule in localStorage;
 *  signed-in users get it mirrored to the DB by ScheduleSync (in the layout). */
export default async function SchedulePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <>
      <Header active="schedule" />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 40px' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>
          Your schedule
        </h1>
        <p className="text-muted" style={{ margin: '4px 0 24px', fontSize: 13 }}>
          {user
            ? `Signed in as ${user.email} — changes save automatically.`
            : 'Add the courses you’ve taken or plan to take. No account needed.'}
        </p>

        <ScheduleEditor signedIn={Boolean(user)} />
      </main>
    </>
  )
}
