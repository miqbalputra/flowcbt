// Review — konfirmasi Selesai (FR-6.5): ringkasan terjawab/kosong/ragu.
// Logika submit offline-first TIDAK berubah (AC-4/FR-7.6).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAttempt, saveAttempt } from '../db'
import { submitSafe } from '../lib/student-api'
import { flush, enqueueSubmit, kick, getEngineState, subscribeSync } from '../lib/sync'
import { SiswaLayout, Panel } from '../components/SiswaLayout'
import { toast } from '@/components/toast'
import { IconCheck, IconClipboard, IconFlag, IconWarn, IconWifi, IconWifiOff } from '@/components/icons'
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
    await saveAttempt({ ...rec, status: rec.status === 'expired' ? 'expired' : 'submitted' })
    await enqueueSubmit(id)
    void flush(id)
    const sent = await submitSafe(id)
    if (sent) {
      toast('Jawaban berhasil dikirim.', 'success')
      nav(`/s/attempt/${id}/done`, { replace: true })
      return
    }
    kick()
    toast('Jawaban tersimpan di perangkat — menunggu internet untuk mengirim.', 'warn')
    nav(`/s/attempt/${id}/done`, { replace: true })
  }

  if (!rec) {
    return (
      <SiswaLayout title="Ringkasan Jawaban">
        <p className="py-10 text-center text-sm text-muted">Memuat ringkasan…</p>
      </SiswaLayout>
    )
  }

  const total = rec.questions.length
  const pct = total ? Math.round((answered / total) * 100) : 0

  return (
    <SiswaLayout
      title="Ringkasan Jawaban"
      subtitle={rec.exam_name}
      titleIcon={<IconClipboard size={17} />}
      width="md"
    >
      <div className="space-y-4">
        <Panel title="Status Pengerjaan" icon={<IconClipboard size={15} />}>
          <div className="grid grid-cols-3 gap-2">
            <StatTile n={answered} label="Terjawab" tone="success" icon={<IconCheck size={14} />} />
            <StatTile n={ragu} label="Ragu-ragu" tone="warn" icon={<IconFlag size={14} />} />
            <StatTile n={blank} label="Kosong" tone="muted" icon={<IconWarn size={14} />} />
          </div>

          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] text-muted">
              <span>Progres pengisian</span>
              <span className="mono font-semibold text-text">{pct}%</span>
            </div>
            <div className="progress" aria-hidden><span style={{ width: `${pct}%` }} /></div>
          </div>

          {ragu > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded border border-border bg-canvas p-2 text-[12.5px] text-muted">
              <IconFlag size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span><b className="text-text">{ragu} soal</b> masih ditandai ragu-ragu — tanda tetap tersimpan, jawaban tetap dikirim.</span>
            </p>
          )}
          {blank > 0 && (
            <p role="status" className="mt-2 flex items-start gap-1.5 rounded border border-warn-line bg-warn-soft p-2 text-[12.5px] text-warn">
              <IconWarn size={14} className="mt-0.5 shrink-0" />
              <span><b>Perhatian:</b> {blank} soal belum dijawab. Soal kosong bernilai 0 — pastikan kamu yakin.</span>
            </p>
          )}
        </Panel>

        <Panel title="Status Koneksi" icon={online ? <IconWifi size={15} /> : <IconWifiOff size={15} />}>
          {!online ? (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed">
              <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-danger" />
              <span>
                <b className="text-danger">Kamu sedang offline.</b> Jawaban tersimpan di perangkat dan dikirim otomatis saat
                internet kembali. <b>Jangan tutup atau bersihkan data peramban.</b>
              </span>
            </p>
          ) : pending > 0 ? (
            <p role="status" className="flex items-start gap-2 text-[13px] text-warn">
              <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-warn" />
              <span className="mono">{pending}</span> jawaban masih disinkronkan ke server — sekejap lagi selesai.
            </p>
          ) : (
            <p role="status" className="flex items-start gap-2 text-[13px] text-success">
              <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-success" />
              Koneksi aktif — semua jawaban sudah tersinkron dan siap dikirim.
            </p>
          )}
        </Panel>

        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-block btn-lg"
            style={{ background: 'var(--c-success-bg)', borderColor: 'var(--c-success-bg)', color: '#fff' }}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? 'Mengirim…' : online ? (<><IconCheck size={18} /> Ya, Selesaikan &amp; Kirim</>) : ('Selesai (menunggu internet)')}
          </button>
          <button type="button" className="btn-ghost btn-block" onClick={() => nav(`/s/attempt/${id}`)}>
            <IconFlag size={15} /> Kembali mengerjakan
          </button>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-muted">
          Setelah dikirim, jawaban tidak dapat diubah. Nilai tampil sesuai pengaturan gurumu.
        </p>
      </div>
    </SiswaLayout>
  )
}

function StatTile({ n, label, tone, icon }: { n: number; label: string; tone: 'success' | 'warn' | 'muted'; icon?: React.ReactNode }) {
  const map = {
    success: { borderColor: 'var(--c-success-line)', background: 'var(--c-success-soft)', color: 'var(--c-success)' },
    warn: { borderColor: 'var(--c-warn-line)', background: 'var(--c-warn-soft)', color: 'var(--c-warn)' },
    muted: { borderColor: 'var(--c-border-strong)', background: 'var(--c-canvas)', color: 'var(--c-muted)' },
  }[tone]
  return (
    <div className="rounded-md border p-2.5 text-center" style={map}>
      <div className="mono flex items-center justify-center gap-1 text-2xl font-bold leading-none" aria-hidden>
        {icon}{n}
      </div>
      <div className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--c-muted)' }}>{label}</div>
      <span className="sr-only">{label}: {n}</span>
    </div>
  )
}
