import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NextStop — Transfer Planner',
  description:
    'Plan your California community college transfer. See which UC and CSU majors you\'re closest to.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
