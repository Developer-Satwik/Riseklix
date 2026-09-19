'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

type SettingsFormProps = {
  action: (formData: FormData) => void | Promise<void>
  children: React.ReactNode
  submitLabel: string
  saved?: boolean
  disabled?: boolean
  footerNote?: string
}

function snapshot(form: HTMLFormElement) {
  return Array.from(new FormData(form).entries())
    .map(([key, value]) => [key, typeof value === 'string' ? value : value.name] as const)
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)
    )
    .map(([key, value]) => key + '=' + value)
    .join('&')
}

function SaveButton({
  dirty,
  disabled,
  label,
}: {
  dirty: boolean
  disabled: boolean
  label: string
}) {
  const { pending } = useFormStatus()
  const isDisabled = disabled || !dirty || pending

  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className="settings-save-button"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}

export function SettingsForm({
  action,
  children,
  submitLabel,
  saved = false,
  disabled = false,
  footerNote,
}: SettingsFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const baselineRef = useRef('')
  const [dirty, setDirty] = useState(false)
  const [savedVisible, setSavedVisible] = useState(saved)

  useEffect(() => {
    if (formRef.current) baselineRef.current = snapshot(formRef.current)
  }, [])

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSavedVisible(false), 2600)
    return () => window.clearTimeout(timer)
  }, [saved])

  function checkDirty() {
    if (!formRef.current) return
    const nextDirty = snapshot(formRef.current) !== baselineRef.current
    setDirty(nextDirty)
    if (nextDirty) setSavedVisible(false)
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="settings-form"
      onInput={checkDirty}
      onChange={checkDirty}
    >
      {children}

      <footer className="settings-form-footer">
        <div className="settings-save-state" aria-live="polite">
          {footerNote ? (
            <span className="settings-footnote">{footerNote}</span>
          ) : savedVisible ? (
            <span className="settings-saved-indicator"><i aria-hidden="true">✓</i> Saved</span>
          ) : dirty ? (
            <span className="settings-unsaved-indicator"><i aria-hidden="true" /> Unsaved changes</span>
          ) : (
            <span className="settings-clean-indicator">No changes</span>
          )}
        </div>

        {!footerNote && (
          <SaveButton dirty={dirty} disabled={disabled} label={submitLabel} />
        )}
      </footer>
    </form>
  )
}
