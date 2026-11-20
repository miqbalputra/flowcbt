// Selesai — nilai besar + status sinkronisasi + tautan riwayat/dashboard.
// AC-4/FR-7.6: bila submit masih menunggu sinkronisasi (offline tadi), halaman
// ini menampilkan "Menunggu sinkronisasi" dan tiap 5 dtk mencoba flush sampai
// server meng-ACK (status final) → UI berubah "Terkirim".
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAttempt, getQueueFor } from '../db'
import { getMyResult, getServerAttempt } from '../lib/student-api'
import { flush, enqueueSubmit } from '../lib/sync'
import { SiswaLayout } from '../components/SiswaLayout'
import type { AttemptRecord } from '../types'
import { fmtDateTime } from '../types'

interface ResultRow {
  score?: number
  show_score?: boolean
  submitted_at?: string
}

const FINAL_STATUSES = ['submitted', 'graded', 'expired']

export default function Done() {
  const { id = '' } = useParams()
  const [rec, setRec] = useState<AttemptRecord | null>(null)
  const recRef = useRef<AttemptRecord | null>(null)
  const [res, setRes] = useState<ResultRow | null>(null)
  // 'pending' = Menunggu sinkronisasi; 'done' = Terkirim (ACK server)
  const [syncState, setSyncState] = useState<'pending' | 'done'>('pending')
  const aliveRef = useRef(true)

  const refreshResult = useCallback(() => {
    getMyResult(id)
      .then(r => {
        if (aliveRef.current && r) setRes(r as ResultRow)
      })
      .catch(() => undefined)
  }, [id])

  useEffect(() => {
    aliveRef.current = true
    getAttempt(id).then(r => {
      if (!aliveRef.current) return
      recRef.current = r ?? null
      setRec(r ?? null)
    })
    refreshResult()

    let timer: ReturnType<typeof setInterval> | undefined
    const stopTimer = () => {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
    }

    async function check() {
      if (!aliveRef.current || !navigator.onLine) return
      try {
        // Sudah final di server? → selesai, tak perlu apa-apa lagi.
        const v = await getServerAttempt(id).catch(() => null)
        if (!aliveRef.current) return
        const st = String(v?.attempt?.status ?? '')
        if (st && FINAL_STATUSES.includes(st)) {
          setSyncState('done')
          stopTimer()
          refreshResult()
          return
        }
        // Belum final di server: pastikan event submit ada di antrean (jaga-jaga
        // sesi lama yang kehilangan event), lalu flush — AC-4. HANYA bila attempt
        // lokal memang sudah ditandai selesai (bukan URL /done yang dibuka liar).
        if (v) {
          const local = recRef.current
          if (local && local.status !== 'in_progress') {
            const rows = await getQueueFor(id)
            if (!aliveRef.current) return
            if (!rows.some(r => r.type === 'submit')) {
              await enqueueSubmit(id)
            }
          }
        }
        await flush(id)
      } catch {
        /* gagal jaringan — dicoba lagi pada siklus berikutnya */
      }
    }

    void check()
    timer = setInterval(() => void check(), 5000)
    return () => {
      aliveRef.current = false
      stopTimer()
    }
  }, [id, refreshResult])

  return (
    <SiswaLayout title="Ujian selesai">
      <div className="card space-y-4 text-center">
        {rec && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{rec.exam_name}</p>
            {typeof res?.submitted_at === 'string' && (
              <p className="text-xs text-muted">Dikirim {fmtDateTime(res.submitted_at)}</p>
            )}
          </div>
        )}

        {/* status sinkron — pertahankan pola refresh 5 dtk yang ada (AC-4) */}
        <p
          role="status"
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium"
          style={
            syncState === 'done'
              ? { borderColor: 'var(--c-success)', background: 'var(--c-success-soft)', color: 'var(--c-success)' }
              : { borderColor: 'var(--c-warn)', background: 'var(--c-warn-soft)', color: 'var(--c-warn)' }
          }
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: syncState === 'done' ? 'var(--c-success)' : 'var(--c-warn)' }}
          />
          {syncState === 'done' ? 'Terkirim ke server' : 'Menunggu sinkronisasi — jangan tutup halaman ini'}
        </p>

        {res?.show_score && typeof res.score === 'number' ? (
          <div className="rounded-lg border border-border bg-canvas py-6">
            <div aria-label={`Nilai akhir ${res.score}`} className="font-mono text-5xl font-bold tabular-nums text-primary">
              {res.score}
            </div>
            <p className="mt-1 text-xs text-muted">Nilai akhir</p>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-canvas px-3 py-4 text-sm text-muted">
            Nilai akan diumumkan gurumu setelah koreksi.
          </p>
        )}

        <div className="grid gap-2">
          <Link to="/s/history" className="btn-primary w-full">Lihat Riwayat</Link>
          <Link to="/s/exams" className="btn-ghost w-full">Kembali ke Dashboard</Link>
        </div>
      </div>
    </SiswaLayout>
  )
}
