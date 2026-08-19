import type { Metadata } from 'next'
import './globals.css'
import { ScheduleSync } from '@/components/schedule/ScheduleSync'

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
      <body>
        <ScheduleSync />
        {children}
      </body>
    </html>
  )
}
