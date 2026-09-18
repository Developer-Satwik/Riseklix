'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

function Icon({ name }: { name: 'settings' | 'help' | 'mail' | 'privacy' | 'terms' | 'logout' | 'chevron' }) {
  const paths: Record<typeof name, React.ReactNode> = {
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 1 1 3.9 2.1c-1 .7-1.6 1.1-1.6 2.4" /><path d="M12 17h.01" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    privacy: <><path d="M12 3 5 6v5c0 4.5 2.7 7.8 7 10 4.3-2.2 7-5.5 7-10V6l-7-3Z" /><path d="m9.5 12 1.7 1.7 3.6-3.7" /></>,
    terms: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
    logout: <><path d="M10 5H5v14h5" /><path d="m14 8 4 4-4 4M18 12H9" /></>,
    chevron: <path d="m9 10 3 3 3-3" />,
  }

  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export function ProfileMenu({
  email,
  displayName,
  organization,
}: {
  email: string
  displayName: string
  organization: string
}) {
  const [open, setOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'R'

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function focusItem(index: number) {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    if (!items?.length) return
    items[Math.max(0, Math.min(index, items.length - 1))]?.focus()
  }

  function openMenu() {
    setOpen(true)
    requestAnimationFrame(() => focusItem(0))
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      openMenu()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => {
        const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
        if (items?.length) items[items.length - 1]?.focus()
      })
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)

    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  return (
    <div className="profile-menu-shell" ref={shellRef}>
      {open && (
        <div
          className="profile-menu-popover"
          id="profile-menu"
          role="menu"
          aria-label="Account menu"
          ref={menuRef}
          onKeyDown={handleMenuKeyDown}
        >
          <div className="profile-menu-header">
            <div>
              <strong>{displayName}</strong>
              <small>{email}</small>
            </div>
            <span>{organization}</span>
          </div>

          <div className="profile-menu-group">
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="settings" />
              <span>Settings</span>
            </Link>
            <Link href="/help" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="help" />
              <span>Help & support</span>
            </Link>
            <a href="mailto:contact@riseklix.com?subject=Riseklix%20Commercial%20Discovery%20Support" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="mail" />
              <span>Contact support</span>
            </a>
          </div>

          <div className="profile-menu-group compact">
            <Link href="/privacy" role="menuitem" onClick={() => setOpen(false)}><Icon name="privacy" /><span>Privacy</span></Link>
            <Link href="/terms" role="menuitem" onClick={() => setOpen(false)}><Icon name="terms" /><span>Terms</span></Link>
          </div>

          <div className="profile-menu-group compact danger">
            <form action="/auth/signout" method="post">
              <button type="submit" role="menuitem"><Icon name="logout" /><span>Sign out</span></button>
            </form>
          </div>
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        className="profile-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="profile-menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="sidebar-avatar" aria-hidden="true">{initials}</span>
        <span className="profile-trigger-copy">
          <strong>{displayName}</strong>
          <small title={email}>{email}</small>
        </span>
        <span className="profile-menu-chevron"><Icon name="chevron" /></span>
      </button>
    </div>
  )
}
