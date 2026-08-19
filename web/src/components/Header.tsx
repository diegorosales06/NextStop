import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { GoogleSignInButton } from './GoogleSignInButton'
import { SignOutButton } from './SignOutButton'

type Section = 'schedule' | 'majors' | 'saved' | null

/** Site header. Server component so it can read the current user on every
 *  request via Supabase. `active` highlights one nav item. */
export async function Header({ active = null }: { active?: Section }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const initials =
    user?.user_metadata?.full_name
      ?.split(' ')
      .map((s: string) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ?? 'ME'

  const navItemStyle = (key: Section) => ({
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: active === key ? 500 : 400,
    background: active === key ? 'var(--surface-2)' : 'transparent',
    color: active === key ? 'var(--text)' : 'var(--text-muted)',
  })

  return (
    <header
      style={{
        height: 60,
        padding: '0 40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'var(--accent)',
              color: 'white',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '-0.02em',
            }}
          >
            NS
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em' }}>
            NextStop
          </div>
        </Link>

        {/* Schedule + Matching majors are public; Saved is account-only. */}
        <nav style={{ display: 'flex', gap: 4 }}>
          <Link href="/schedule" style={navItemStyle('schedule')}>
            Schedule
          </Link>
          <Link href="/majors" style={navItemStyle('majors')}>
            Matching majors
          </Link>
          {user && (
            <Link href="/saved" style={navItemStyle('saved')}>
              Saved
            </Link>
          )}
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {user ? (
          <>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #f4b183, #d67c3a)',
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 600,
                fontSize: 12,
              }}
              title={user.email ?? ''}
            >
              {initials}
            </div>
            <SignOutButton />
          </>
        ) : (
          <GoogleSignInButton />
        )}
      </div>
    </header>
  )
}
