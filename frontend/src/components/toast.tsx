// Komponen toast sederhana — dipakai: import { toast } from '@/components/toast'
import { useEffect, useState, type ReactNode } from 'react'

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
const ICONS: Record<ToastKind, string> = { success: '✓', error: '⚠', info: 'ℹ', warn: '⚠' }

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
        {items.map(t => (
          <div
            key={t.id}
            className="pointer-events-auto max-w-sm w-auto rounded-xl px-4 py-3 text-white text-sm shadow-lg flex items-center gap-2"
            style={{ background: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border)' }}
          >
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm text-white"
              style={{ background: COLORS[t.kind] }}
            >
              {ICONS[t.kind]}
            </span>
            <span className="min-w-0">{t.msg}</span>
          </div>
        ))}
      </div>
    </>
  )
}
