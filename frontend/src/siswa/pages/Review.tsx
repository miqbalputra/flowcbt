// Review — konfirmasi Selesai (FR-6.5): ringkasan terjawab/kosong/ragu,
// peringatan bila ada yang kosong; konfirmasi → submit. Terlepas OFFLINE:
// jawaban terkunci lokal, status "Menunggu sinkronisasi" (FR-7.6/AC-4).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAttempt, saveAttempt } from '../db'
import { submitSafe } from '../lib/student-api'
import { flush, enqueueSubmit, kick, getEngineState, subscribeSync } from '../lib/sync'
import { SiswaLayout } from '../components/SiswaLayout'
import { toast } from '@/components/toast'
import { IconCheck, IconFlag, IconWarn } from '@/components/icons'
import type { AttemptRecord } from '../types'

export default function Review() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [rec, setRec] = useState<AttemptRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(getEngineState().pending)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    let alive = true
    getAttempt(id).then(r => alive && setRec(r ?? null))
    const unsub = subscribeSync(s => {
      setPending(s.pending)
      if (s.syncing === false && s.pending === 0) setOnline(navigator.onLine)
    })
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      alive = false
      unsub()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [id])

  const { answered, blank, ragu } = useMemo(() => {
    let answered = 0, ragu = 0
    const answers = rec?.answers ?? {}
    const flags = rec?.flags ?? {}
    for (const q of rec?.questions ?? []) {
      const v = answers[q.id]
      const filled = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== ''
      if (filled) answered++
      if (flags[q.id]) ragu++
    }
    return { answered, blank: (rec?.questions?.length ?? 0) - answered, ragu }
  }, [rec])

  async function confirm() {
    if (!rec || busy) return
    setBusy(true)
    // tandai selesai lokal + antrean submit event (jalan walau offline, AC-4)
    await saveAttempt({ ...rec, status: rec.status === 'expired' ? 'expired' : 'submitted' })
    // AC-4/FR-7.6: event submit MASUK ANTREAN lebih dulu — bila offline,
    // flush berikutnya yang mengirimkannya sehingga attempt tetap final di server.
    await enqueueSubmit(id)
    void flush(id)
    const sent = await submitSafe(id)
    if (sent) {
      toast('Jawaban berhasil dikirim.', 'success')
      nav(`/s/attempt/${id}/done`, { replace: true })
      return
    }
    // OFFLINE → terkunci "menunggu internet" (FR-7.6)
    kick()
    toast('Jawaban tersimpan di perangkat — menunggu internet untuk mengirim.', 'warn')
    nav(`/s/attempt/${id}/done`, { replace: true })
  }

  if (!rec) {
    return (
      <SiswaLayout title="Ringkasan">
        <p className="text-center text-muted">Memuat ringkasan…</p>
      </SiswaLayout>
    )
  }

  return (
    <SiswaLayout title="Ringkasan jawaban" subtitle={`${rec.exam_name} — periksa sebelum menyerahkan`}>
      <div className="card space-y-3">
        {/* grid statistik: ikon status + angka font-mono besar (directive) */}
        <div className="grid grid-cols-3 gap-2">
          <StatTile n={answered} label="Terjawab" tone="success" icon={<IconCheck size={14} />} />
          <StatTile n={ragu} label="Ragu-ragu" tone="warn" icon={<IconFlag size={14} />} />
          <StatTile n={blank} label="Kosong" tone="canvas" icon={<IconWarn size={14} />} />
        </div>

        {ragu > 0 && (
          <p className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas p-2 text-xs text-muted">
            <IconFlag size={13} className="shrink-0 text-warn" aria-hidden />
            <span>
              {ragu} soal ditandai <i>ragu-ragu</i> — tandanya tetap ikut terkirim.
            </span>
          </p>
        )}
        {blank > 0 && (
          <p
            role="status"
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: 'var(--c-warn)', background: 'var(--c-warn-soft)', color: 'var(--c-warn)' }}
          >
            <b>Perhatian:</b> masih ada {blank} soal belum dijawab. Yakin ingin menyerahkan?
          </p>
        )}
        {!online ? (
          <p
            className="rounded-lg border p-3 text-sm leading-relaxed"
            style={{ borderColor: 'var(--c-danger)', background: 'var(--c-danger-soft)' }}
          >
            <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: 'var(--c-danger)' }} />
            <b>Kamu sedang offline.</b> Jawabanmu tersimpan di perangkat dan akan dikirim otomatis
            saat internet kembali. <b>Jangan tutup atau bersihkan data browser!</b>
          </p>
        ) : pending > 0 ? (
          <p
            role="status"
            className="rounded-lg border p-2 text-sm"
            style={{ borderColor: 'var(--c-warn)', background: 'var(--c-warn-soft)', color: 'var(--c-warn)' }}
          >
            {pending} jawaban masih disinkronkan ke server — sekejap lagi selesai.
          </p>
        ) : (
          <p role="status" className="rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--c-success)', background: 'var(--c-success-soft)', color: 'var(--c-success)' }}>
            Koneksi aktif — semua jawaban tersinkron, siap dikirim.
          </p>
        )}

        {/* tombol hijau konfirmasi (bg token success, dark aman — directive §D) */}
        <button
          type="button"
          className="btn-primary w-full min-h-12"
          style={{ background: 'var(--c-success)' }}
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? (
            'Mengirim…'
          ) : online ? (
            <>
              <IconCheck size={16} />
              Ya, Selesaikan &amp; Kirim
            </>
          ) : (
            'Selesai (menunggu internet)'
          )}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => nav(`/s/attempt/${id}`)}>
          ← Kembali mengerjakan
        </button>
      </div>
    </SiswaLayout>
  )
}

function StatTile({
  n,
  label,
  tone,
  icon,
}: {
  n: number
  label: string
  tone: 'success' | 'warn' | 'canvas'
  icon?: React.ReactNode
}) {
  const style =
    tone === 'success'
      ? { background: 'var(--c-success-soft)', borderColor: 'var(--c-success)', color: 'var(--c-success)' }
      : tone === 'warn'
        ? { background: 'var(--c-warn-soft)', borderColor: 'var(--c-warn)', color: 'var(--c-warn)' }
        : { background: 'var(--c-canvas)', borderColor: 'var(--c-border-strong)', color: 'var(--c-muted)' }
  return (
    <div className="rounded-lg border p-2.5 text-center" style={style}>
      <div className="mb-0.5 flex items-center justify-center gap-1 font-mono text-2xl font-bold tabular-nums" aria-hidden>
        {icon}
        {n}
      </div>
      <div className="text-[11px] font-medium" style={{ color: 'var(--c-muted)' }}>{label}</div>
      <span className="sr-only">{label}: {n}</span>
    </div>
  )
}
