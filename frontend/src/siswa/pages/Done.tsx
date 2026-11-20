// Selesai — nilai besar + status sinkronisasi + tautan riwayat/keluar.
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
      <div className="card space-y-3 text-center">
        {rec && (
          <p className="text-sm font-semibold">{rec.exam_name}</p>
        )}

        <p
          role="status"
          className={`rounded-lg border p-2 text-sm font-medium ${
            syncState === 'done'
              ? 'border-success bg-success/10 text-success'
              : 'border-warn bg-warn/10 text-warn'
          }`}
        >
          {syncState === 'done' ? '✅ Terkirim' : '⏳ Menunggu sinkronisasi — jangan tutup halaman ini'}
        </p>

        {res?.show_score && typeof res.score === 'number' ? (
          <>
            <p className="text-4xl font-extrabold text-primary">{res.score}</p>
            <p className="text-sm text-muted">Skor akhir ({fmtDateTime(res.submitted_at)})</p>
          </>
        ) : (
          <p className="text-sm text-muted">Nilai akan diumumkan guru.</p>
        )}
        <Link to="/s/history" className="btn-ghost w-full text-center">
          Lihat riwayat
        </Link>
      </div>
    </SiswaLayout>
  )
}
