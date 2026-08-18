'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button
      onClick={signOut}
      style={{
        height: 28,
        padding: '0 10px',
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--text-muted)',
        fontFamily: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      Sign out
    </button>
  )
}
