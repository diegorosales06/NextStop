import Link from 'next/link'
import { Header } from '@/components/Header'

export default function AuthErrorPage() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 40px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
          Sign-in failed
        </h1>
        <p className="text-muted" style={{ marginBottom: 20 }}>
          We couldn&apos;t complete the sign-in. This usually means the
          OAuth callback URL isn&apos;t configured in Supabase yet. Check the
          project&apos;s Auth Providers settings.
        </p>
        <Link href="/" className="text-accent" style={{ fontSize: 14 }}>
          ← Back to home
        </Link>
      </main>
    </>
  )
}
