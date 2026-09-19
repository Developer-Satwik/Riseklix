'use client'

import { useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { deleteAnalysis } from '@/app/(app)/projects/actions'

function DeleteSubmit({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      className="analysis-delete-confirm"
      disabled={!enabled || pending}
    >
      {pending ? 'Deleting…' : 'Delete analysis'}
    </button>
  )
}

export function AnalysisDeleteControl({
  projectId,
  projectName,
  variant = 'menu',
}: {
  projectId: string
  projectName: string
  variant?: 'menu' | 'icon'
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [confirmation, setConfirmation] = useState('')

  function openDialog() {
    setConfirmation('')
    dialogRef.current?.showModal()
  }

  function closeDialog() {
    dialogRef.current?.close()
    setConfirmation('')
  }

  return (
    <>
      <button
        type="button"
        className={variant === 'icon' ? 'analysis-delete-trigger icon' : 'analysis-delete-trigger'}
        onClick={openDialog}
        aria-label={variant === 'icon' ? 'Delete analysis' : undefined}
        title={variant === 'icon' ? 'Delete analysis' : undefined}
      >
        {variant === 'icon' ? '⋮' : 'Delete analysis'}
      </button>

      <dialog
        ref={dialogRef}
        className="analysis-delete-dialog"
        onCancel={(event) => {
          event.preventDefault()
          closeDialog()
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDialog()
        }}
      >
        <form action={deleteAnalysis} className="analysis-delete-form">
          <input type="hidden" name="project_id" value={projectId} />

          <div className="eyebrow">PERMANENT ACTION</div>
          <h2>Delete {projectName}?</h2>
          <p>
            This permanently removes the analysis and its connected Company Intelligence,
            Buyer Situations, competitor research, benchmark observations, findings,
            blueprints and recheck history. This cannot be undone.
          </p>

          <label>
            Type <strong>{projectName}</strong> to confirm
            <input
              name="confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>

          <div className="analysis-delete-actions">
            <button type="button" className="analysis-delete-cancel" onClick={closeDialog}>Cancel</button>
            <DeleteSubmit enabled={confirmation === projectName} />
          </div>
        </form>
      </dialog>
    </>
  )
}
