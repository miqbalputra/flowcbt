// Komponen toast sederhana — dipakai: import { toast } from '@/components/toast'
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { IconAlertCircle, IconCheck, IconInfo, IconWarn } from '@/components/icons'

export type ToastKind = 'success' | 'error' | 'info' | 'warn'
type Item = { id: number; msg: string; kind: ToastKind }

let push: ((msg: string, kind: ToastKind) => void) | null = null

/** Tampilkan pesan singkat di bawah layar: toast('Tersimpan', 'success') */
export function toast(msg: string, kind: ToastKind = 'info') {
  push?.(msg, kind)
}

const COLORS: Record<ToastKind, string> = {
  success: 'var(--c-success)',
  error: 'var(--c-danger)',
  info: 'var(--c-primary)',
  warn: 'var(--c-warn)',
}
const ICONS: Record<ToastKind, ComponentType<{ size?: number }>> = {
  success: IconCheck, error: IconAlertCircle, info: IconInfo, warn: IconWarn,
}
const CHIP: Record<ToastKind, string> = {
  success: 'bg-success-soft text-success',
  error: 'bg-danger-soft text-danger',
  info: 'bg-primary-soft text-primary',
  warn: 'bg-warn-soft text-warn',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let seq = 0
    push = (msg, kind) => {
      const id = ++seq
      setItems(prev => [...prev.slice(-3), { id, msg, kind }])
      window.setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 3200)
    }
    return () => { push = null }
  }, [])

  return (
    <>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-4 z-[70] flex flex-col gap-2 items-end pointer-events-none"
      >
        {items.map(t => {
          const Ico = ICONS[t.kind]
          return (
            <div
              key={t.id}
              className="pointer-events-auto w-full max-w-sm rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm shadow-sm flex items-center gap-2.5"
              style={{ borderLeft: `3px solid ${COLORS[t.kind]}` }}
            >
              <span aria-hidden className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${CHIP[t.kind]}`}>
                <Ico size={13} />
              </span>
              <span className="min-w-0 break-words">{t.msg}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
