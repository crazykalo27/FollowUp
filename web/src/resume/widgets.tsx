import type { ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="resume-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="resume-modal-backdrop" aria-label="Close dialog" onClick={onClose} />
      <div className="resume-modal-card">
        <header className="resume-modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost btn-sm" onClick={onClose}>Close</button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Confirm({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{body}</p>
      <div className="resume-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  )
}
