// Modal overlay — di mobile (≤640) menjadi bottom sheet (PRD FR-11.2)
import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({
  open, onClose, title, children, footer,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    // simpan elemen berfokus sebelum modal terbuka → pulihkan saat tertutup (a11y)
    const active = document.activeElement
    prevFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prevFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Dialog'}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-surface border border-border rounded-t-lg sm:rounded-lg shadow-sm outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface">
          <h2 className="font-semibold text-base min-w-0 truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="btn-ghost touch-target w-11 h-11 !p-0 shrink-0"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">{children}</div>
        {footer && (
          <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 px-4 py-3 border-t border-border bg-surface">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open, title = 'Yakin?', message, confirmLabel = 'Ya, lanjutkan', busy,
  danger, onConfirm, onClose,
}: {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  )
}
