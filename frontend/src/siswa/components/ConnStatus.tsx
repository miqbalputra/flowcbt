// Indikator status koneksi — sticker di header runner (FR-7.7).
// 🟢 Online & tersinkron · 🟡 Menyinkron (n) · 🔴 Offline (jawaban tersimpan lokal)
import { useEffect, useState } from 'react'
import { getEngineState, subscribeSync, type EngineState } from '../lib/sync'

export function ConnStatus({ inline = false }: { inline?: boolean }) {
  const [s, setS] = useState<EngineState>(getEngineState())
  useEffect(() => subscribeSync(setS), [])

  const dot = !s.online ? '🔴' : s.syncing || s.pending > 0 ? '🟡' : '🟢'
  const label = !s.online
    ? 'Offline — jawaban tersimpan di perangkat'
    : s.syncing || s.pending > 0
      ? `Menyinkron${s.pending > 0 ? ` (${s.pending})` : ''}…`
      : 'Online'

  return (
    <span
      className={`badge shrink-0 ${inline ? '' : 'max-w-[9.5rem]'} ${s.online ? 'bg-[var(--c-success)] text-white' : ''}`}
      style={!s.online ? { background: 'var(--c-danger)', color: 'white' } : undefined}
      title={label}
      role="status"
      aria-label={label}
    >
      <span className="whitespace-nowrap overflow-hidden text-ellipsis">
        {dot} {inline ? label : label.split(' —')[0]}
      </span>
    </span>
  )
}
