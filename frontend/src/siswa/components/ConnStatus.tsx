// Indikator status sinkronisasi header runner (FR-7.7) — ikon + teks, soft bg:
// IconWifi Tersimpan (hijau) · dot berdenyut Menyinkron (n) (amber) ·
// IconWifiOff Offline — tersimpan di perangkat (merah). Tanpa emoji.
import { useEffect, useState } from 'react'
import { getEngineState, subscribeSync, type EngineState } from '../lib/sync'
import { IconWifi, IconWifiOff } from '@/components/icons'

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
      {s.online ? (
        syncing ? (
          // dot bergerak (sinkron berjalan) — bukan emoji
          <span aria-hidden className="relative flex h-2 w-2 shrink-0" style={{ color: varFg }}>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: 'currentColor' }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'currentColor' }} />
          </span>
        ) : (
          <IconWifi size={14} className="shrink-0" />
        )
      ) : (
        <IconWifiOff size={14} className="shrink-0" />
      )}
      <span className="max-w-[10rem] truncate whitespace-nowrap">{label}</span>
    </span>
  )
}
