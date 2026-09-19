'use client'

import { useFormStatus } from 'react-dom'

export function PendingButton({
  children,
  pendingLabel = 'Working…',
  className,
  name,
  value,
  disabled,
}: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
  name?: string
  value?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending && <span className="button-spinner" aria-hidden="true" />}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  )
}
