// Review — konfirmasi Selesai (FR-6.5): ringkasan terjawab/kosong/ragu,
// peringatan bila ada yang kosong; konfirmasi → submit.ertam OFFLINE:
// jawaban terkunci lokal, status "Menunggu sinkronisasi" (FR-7.6/AC-4).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAttempt, saveAttempt } from '../db'
import { submitSafe } from '../lib/student-api'
import { flush, enqueueSubmit, kick, getEngineState, subscribeSync } from '../lib/sync'
import { SiswaLayout } from '../components/SiswaLayout'
import { toast } from '@/components/toast'
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
      toast('Jawaban berhasil dikirim. 🎉', 'success')
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
    <SiswaLayout title="Ringkasan jawaban" subtitle="Periksa sebelum menyerahkan">
      <div className="card space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-success/10 p-3">
            <div className="text-2xl font-bold text-success">{answered}</div>
            <div className="text-xs text-muted">Terjawab</div>
          </div>
          <div className="rounded-lg bg-warn/10 p-3">
            <div className="text-2xl font-bold text-warn">★ {ragu}</div>
            <div className="text-xs text-muted">Ragu-ragu</div>
          </div>
          <div className="rounded-lg bg-danger/10 p-3">
            <div className="text-2xl font-bold text-danger">{blank}</div>
            <div className="text-xs text-muted">Belum dijawab</div>
          </div>
        </div>

        {blank > 0 && (
          <p className="rounded-lg border border-warn bg-warn/10 p-2 text-sm text-warn">
            ⚠️ Masih ada {blank} soal belum dijawab. Yakin ingin menyerahkan?
          </p>
        )}
        {!online && (
          <p className="rounded-lg border border-danger bg-danger/10 p-3 text-sm">
            🔴 <b>Kamu sedang offline.</b> Jawabanmu tersimpan di perangkat dan akan
            dikirim otomatis saat internet kembali. <b>Jangan tutup/kosongkan data browser!</b>
          </p>
        )}

        <button className="btn-primary w-full" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Mengirim…' : online ? '✅ Ya, kirim sekarang' : 'Selesai (menunggu internet)'}
        </button>
        <button className="btn-ghost w-full" onClick={() => nav(`/s/attempt/${id}`)}>
          ← Kembali mengerjakan
        </button>
      </div>
    </SiswaLayout>
  )
}
