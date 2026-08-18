'use client'

import { createClient } from '@/lib/supabase/client'

export function GoogleSignInButton() {
  async function signIn() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`,
      },
    })
  }

  return (
    <button
      onClick={signIn}
      style={{
        height: 36,
        padding: '0 14px',
        border: '1px solid var(--border-strong)',
        borderRadius: 6,
        background: 'var(--surface)',
        color: 'var(--text)',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 48 48">
        <path fill="#4285f4" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#34a853" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3 0 5.8 1.1 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4c-7.7 0-14.4 4.4-17.7 10.7z" />
        <path fill="#fbbc05" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.3c-2 1.4-4.6 2.3-7.5 2.3-5.3 0-9.7-3.3-11.3-8l-6.5 5c3.3 6.3 10 10.4 17.8 10.4z" />
        <path fill="#ea4335" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.4-4.3 5.9l6.5 5.3c-.4.4 6.5-4.8 6.5-15.2 0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Sign in with Google
    </button>
  )
}
