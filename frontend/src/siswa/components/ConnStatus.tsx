// Indikator status sinkronisasi header runner (FR-7.7) — dot + teks, soft bg:
// ● Tersimpan (hijau) · ● Menyinkron (n) (amber) · ● Offline — tersimpan di
// perangkat (merah). Sumber state: getEngineState/subscribeSync (engine sync).
import { useEffect, useState } from 'react'
import { getEngineState, subscribeSync, type EngineState } from '../lib/sync'

export function ConnStatus({ short = false }: { short?: boolean }) {
  const [s, setS] = useState<EngineState>(getEngineState())
  useEffect(() => subscribeSync(setS), [])

  const syncing = s.syncing || s.pending > 0
  const varFg = !s.online ? 'var(--c-danger)' : syncing ? 'var(--c-warn)' : 'var(--c-success)'
  const varBg = !s.online ? 'var(--c-danger-soft)' : syncing ? 'var(--c-warn-soft)' : 'var(--c-success-soft)'
  const full = !s.online
    ? 'Offline — tersimpan di perangkat'
    : syncing
      ? `Menyinkron (${s.pending})`
      : 'Tersimpan'
  const mini = !s.online ? 'Offline' : syncing ? `Sinkron (${s.pending})` : 'Tersimpan'
  const label = short ? mini : full

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="badge shrink-0 border"
      style={{ background: varBg, color: varFg, borderColor: `color-mix(in srgb, ${varFg} 35%, transparent)` }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: varFg }} />
      <span className="max-w-[10rem] truncate whitespace-nowrap">{label}</span>
    </span>
  )
}
