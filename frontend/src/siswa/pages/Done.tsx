// Selesai — status pengiriman + nilai (bila dirilis) + tautan lanjutan.
// Logika polling 5 dtk & enqueue submit dipertahankan (AC-4/FR-7.6).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAttempt, getQueueFor } from '../db'
import { getMyResult, getServerAttempt } from '../lib/student-api'
import { flush, enqueueSubmit } from '../lib/sync'
import { SiswaLayout, Panel, MetaRow } from '../components/SiswaLayout'
import { IconChart2, IconCheck, IconDashboard, IconWifi, IconWifiOff, IconTrophy } from '@/components/icons'
import type { AttemptRecord } from '../types'
import { fmtDateTime } from '../types'

interface ResultRow {
  score?: number
  final_score?: number
  final_score_pending?: boolean
  penalty_points?: number
  violations_count?: number
  status?: string
  show_score?: boolean
  submitted_at?: string
  [k: string]: unknown
}

const FINAL_STATUSES = ['submitted', 'graded', 'expired']

export default function Done() {
  const { id = '' } = useParams()
  const [rec, setRec] = useState<AttemptRecord | null>(null)
  const recRef = useRef<AttemptRecord | null>(null)
  const [res, setRes] = useState<ResultRow | null>(null)
  const [serverMeta, setServerMeta] = useState<{ name?: string; code?: string; count?: number } | null>(null)
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
        const v = await getServerAttempt(id).catch(() => null)
        if (!aliveRef.current) return
        const st = String(v?.attempt?.status ?? '')
        if (st && FINAL_STATUSES.includes(st)) {
          setSyncState('done')
          stopTimer()
          refreshResult()
          return
        }
        if (v) {
          const meta = (v.attempt ?? {}) as Record<string, unknown>
          setServerMeta(prev => prev ?? {
            name: typeof meta.exam_name === 'string' ? meta.exam_name : undefined,
            code: typeof meta.exam_code === 'string' ? meta.exam_code : undefined,
            count: Array.isArray((v as { package?: { questions?: unknown[] } }).package?.questions)
              ? (v as { package?: { questions?: unknown[] } }).package?.questions?.length
              : undefined,
          })
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
        /* dicoba lagi siklus berikutnya */
      }
    }

    void check()
    timer = setInterval(() => void check(), 5000)
    return () => {
      aliveRef.current = false
      stopTimer()
    }
  }, [id, refreshResult])

  // FR-8.2/FR-5.4 — tampilkan final_score (skala 100) bila sudah dirilis &
  // dinilai; angka mentah & penalti sebagai detail sekunder (AC-8 transparan).
  const finalScore =
    typeof res?.final_score === 'number' ? res.final_score
      : typeof res?.score === 'number' ? res.score
        : null
  const pending = Boolean(res?.final_score_pending)
  const penalty = Number(res?.penalty_points ?? 0)
  const violations = Number(res?.violations_count ?? 0)
  const hasScore = finalScore !== null && (res?.show_score !== false)
  const examName = rec?.exam_name || serverMeta?.name || 'Ujian'
  const examCode = rec?.exam_code || serverMeta?.code || '—'
  const questionCount = rec?.questions?.length ?? serverMeta?.count ?? 0

  return (
    <SiswaLayout title="Ujian Selesai" titleIcon={<IconCheck size={17} />} width="md">
      <div className="space-y-4">
        {/* banner hasil */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
          <div className="rule-accent flex items-start gap-3 border-b border-border p-4">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-success-line bg-success-soft text-success"
            >
              <IconCheck size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight">Jawaban berhasil diserahkan</h1>
              <p className="mt-0.5 text-[13px] text-muted">
                {examName} {examCode && examCode !== '—' ? `· ${examCode}` : ''}
              </p>
            </div>
          </div>

          <div className="p-4">
            <div
              role="status"
              className={`flex min-h-10 items-center gap-2 rounded border px-3 text-[13px] font-medium ${
                syncState === 'done'
                  ? 'border-success-line bg-success-soft text-success'
                  : 'border-warn-line bg-warn-soft text-warn'
              }`}
            >
              {syncState === 'done' ? <IconWifi size={15} /> : <IconWifiOff size={15} />}
              <span>
                {syncState === 'done'
                  ? 'Terkirim ke server — jawaban tersimpan permanen.'
                  : 'Menunggu sinkronisasi — jangan tutup halaman ini.'}
              </span>
            </div>

            {hasScore ? (
              <div className="mt-3 rounded-md border border-primary-line bg-primary-soft px-4 py-5 text-center">
                <div className="section-label text-primary">{pending ? 'Nilai sementara' : 'Nilai akhir'}</div>
                <div className="mono mt-1 text-5xl font-bold leading-none tracking-tight text-primary" aria-label={`Nilai akhir ${finalScore}`}>
                  {finalScore}
                </div>
                {typeof res?.score === 'number' && typeof res?.final_score === 'number' && (
                  <p className="mt-1.5 text-[11.5px] text-primary/80">
                    Skor mentah <span className="mono font-bold">{res.score}</span> poin{penalty > 0 ? ` · penalti pelanggaran −${penalty} poin` : ''}
                  </p>
                )}
                {pending && (
                  <p className="mt-1 text-[11.5px] text-primary/80">Ada soal uraian yang masih menunggu penilaian guru.</p>
                )}
              </div>
            ) : (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-canvas p-3 text-[13px] text-muted">
                <IconTrophy size={16} className="mt-0.5 shrink-0" />
                Nilai akan diumumkan gurumu setelah proses koreksi selesai.
              </div>
            )}

            <dl className="mt-3">
              <MetaRow label="Nama ujian" value={examName} />
              <MetaRow label="Kode ujian" value={examCode} mono />
              {res?.submitted_at && <MetaRow label="Waktu dikirim" value={fmtDateTime(res.submitted_at)} />}
              <MetaRow label="Jumlah soal" value={`${questionCount} butir`} mono />
              {violations > 0 && (
                <MetaRow
                  label="Catatan pengawas"
                  value={`${violations} pelanggaran tata tertib tercatat${penalty > 0 ? ` (${penalty} poin penalti)` : ''}`}
                />
              )}
            </dl>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link to="/s/history" className="btn btn-primary">
            <IconChart2 size={16} /> Lihat Riwayat
          </Link>
          <Link to="/s/exams" className="btn-ghost">
            <IconDashboard size={16} /> Kembali ke Dashboard
          </Link>
        </div>

        <Panel title="Apa selanjutnya?">
          <ul className="space-y-1.5 text-[13px] text-muted">
            <li>• Nilai tampil di menu Riwayat bila gurumu mengizinkannya.</li>
            <li>• Simpan bukti pengiriman ini (tangkapan layar) bila diperlukan.</li>
            <li>• Hubungi pengawas bila status masih “menunggu sinkronisasi” lebih dari 10 menit.</li>
          </ul>
        </Panel>
      </div>
    </SiswaLayout>
  )
}
