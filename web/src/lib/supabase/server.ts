import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/database.types'

/** Supabase client for use in Server Components, Route Handlers, and Server
 *  Actions. Wraps Next's cookies() so auth session cookies are read/written
 *  transparently. */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component — set is a no-op here. That's
            // fine as long as middleware runs on the same request and
            // refreshes the session cookie itself.
          }
        },
      },
    },
  )
}
