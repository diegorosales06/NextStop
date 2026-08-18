import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/** OAuth callback handler.
 *  Supabase redirects here after Google sign-in with a ?code=… we exchange
 *  for a session cookie. Then we bounce to `next` (or /schedule by default).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/schedule'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}
