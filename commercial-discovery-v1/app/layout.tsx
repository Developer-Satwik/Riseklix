import type { Metadata } from 'next'
import './globals.css'
import './research.css'
import './design-system.css'
import './typography.css'

export const metadata: Metadata = {
  title: 'Riseklix — AI Commercial Discovery',
  description: 'Find the buying situations where AI should consider your business, understand why it does not, and turn the gaps into work.',
  icons: {
    icon: '/riseklix-logo.png',
    shortcut: '/riseklix-logo.png',
    apple: '/riseklix-logo.png',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
