import type { Metadata } from 'next'
import './globals.css'
import './research.css'
import './competitors.css'

export const metadata: Metadata = {
  title: 'Riseklix — AI Commercial Discovery',
  description: 'Find the buying situations where AI should consider your business, understand why it does not, and turn the gaps into work.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
