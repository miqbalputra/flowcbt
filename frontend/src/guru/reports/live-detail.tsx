// Pantauan live per ujian (FR-9.2..9.5) — polling 10 detik via TanStack Query refetchInterval.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useLiveStream, type LiveStreamStatus } from '@/lib/useLiveStream'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import {
  Callout, EmptyState, ErrorBox, PageHeader, Panel, ProgressBar, SearchBox,
  SkeletonRows, StatCard, TableToolbar,
} from '../ui'
import { asDict, asList, attemptStatus, errMessage, unwrap } from '../types'
import {
  IconChart2, IconCheck, IconClock, IconHistory, IconLeft, IconRefresh, IconShield,
  IconStudents, IconWifi, IconWifiOff,
} from '@/components/icons'

/** warna garis badge mengikuti tone teks dari attemptStatus() */
function softLine(cls: string): string {
  if (cls.includes('danger')) return 'border-danger-line'
  if (cls.includes('warn')) return 'border-warn-line'
  if (cls.includes('success')) return 'border-success-line'
  if (cls.includes('primary')) return 'border-primary-line'
  return 'border-border'
}

function isOnline(s: Record<string, any>): boolean {
  return Boolean(s.online ?? String(s.connection ?? 'online') === 'online')
}

/** Indikator sumber data live: SSE, sedang menyegarkan, atau fallback polling. */
function LivePill({ status, fetching }: { status: LiveStreamStatus; fetching: boolean }) {
  if (status === 'live') {
    return (
      <span className="badge border border-success-line bg-success-soft text-success">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
        Real-time
      </span>
    )
  }
  if (fetching) {
    return (
      <span className="badge border border-primary-line bg-primary-soft text-primary">
        <IconRefresh size={11} /> Menyegarkan…
      </span>
    )
  }
  return (
    <span className="badge border border-border bg-canvas text-muted">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      Polling 10 dtk
    </span>
  )
}

/* ---------------------------------------------------------------------------
 * Grafik progres peserta — histogram distribusi + batang status + per kelas.
 * Tanpa pustaka eksternal: cukup div + CSS agar tetap responsif & tajam.
 * ------------------------------------------------------------------------- */

/** Persen progres satu peserta (0 bila total soal belum diketahui). */
function progressPct(s: Record<string, any>): number {
  const total = Number(s.total ?? 0)
  const answered = Number(s.answered ?? 0)
  if (total <= 0 || answered <= 0) return 0
  return Math.min(100, Math.round((answered / total) * 100))
}

const PROGRESS_BUCKETS: { label: string; from: number; to: number; color: string }[] = [
  { label: '0%', from: 0, to: 0, color: 'var(--c-border-strong)' },
  { label: '1–25%', from: 1, to: 25, color: 'var(--c-primary)' },
  { label: '26–50%', from: 26, to: 50, color: 'var(--c-primary)' },
  { label: '51–75%', from: 51, to: 75, color: 'var(--c-primary)' },
  { label: '76–99%', from: 76, to: 99, color: 'var(--c-primary)' },
  { label: '100%', from: 100, to: 100, color: 'var(--c-success)' },
]

/** Histogram: sebaran progres seluruh peserta yang tampil. */
function ProgressHistogram({ students }: { students: Record<string, any>[] }) {
  const pcts = students.map(progressPct)
  const counts = PROGRESS_BUCKETS.map(b => pcts.filter(p => p >= b.from && p <= b.to).length)
  const max = Math.max(1, ...counts)
  return (
    <div>
      <div
        className="flex h-32 items-end gap-1.5 sm:gap-2"
        role="img"
        aria-label={`Sebaran progres: ${PROGRESS_BUCKETS.map((b, i) => `${b.label} ${counts[i]} peserta`).join(', ')}`}
      >
        {PROGRESS_BUCKETS.map((b, i) => (
          <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className={`mono text-[11px] font-bold ${counts[i] ? 'text-text' : 'text-muted'}`}>
              {counts[i]}
            </span>
            <div
              className="w-full max-w-12 rounded-t-[4px] transition-[height] duration-300"
              style={{
                height: `${Math.max(counts[i] ? 4 : 2, (counts[i] / max) * 100)}%`,
                background: b.color,
                opacity: counts[i] ? 1 : 0.35,
              }}
              title={`${b.label}: ${counts[i]} peserta`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-border pt-1.5 sm:gap-2">
        {PROGRESS_BUCKETS.map(b => (
          <span key={b.label} className="flex-1 text-center text-[10px] font-semibold text-muted">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Batang status bertumpuk (selesai / mengerjakan / belum mulai). */
function StatusStack({
  working, done, notStarted, participants,
}: { working: number; done: number; notStarted: number; participants: number }) {
  const pct = (n: number) => (participants > 0 ? (n / participants) * 100 : 0)
  const parts = [
    { label: 'Selesai', n: done, color: 'var(--c-success)', w: pct(done) },
    { label: 'Mengerjakan', n: working, color: 'var(--c-primary)', w: pct(working) },
    { label: 'Belum mulai', n: notStarted, color: 'var(--c-border-strong)', w: pct(notStarted) },
  ]
  return (
    <div>
      <div className="flex h-3.5 w-full overflow-hidden rounded-full border border-border bg-canvas" role="img"
        aria-label={`Komposisi peserta: ${parts.map(p => `${p.label} ${p.n}`).join(', ')}`}>
        {parts.map(p => (
          <div key={p.label} style={{ width: `${p.w}%`, background: p.color }} title={`${p.label}: ${p.n}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {parts.map(p => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label}
            <b className="mono">{p.n}</b>
            <span className="text-muted">({Math.round(p.w)}%)</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Rata-rata progres per kelas — baris ringkas dengan bar mini. */
function ClassProgress({ students }: { students: Record<string, any>[] }) {
  const map = new Map<string, { label: string; n: number; sum: number }>()
  for (const s of students) {
    const cid = String(s.class_id ?? '')
    const label = String(s.class ?? s.class_id ?? '—')
    const cur = map.get(cid) ?? { label, n: 0, sum: 0 }
    cur.n += 1
    cur.sum += progressPct(s)
    map.set(cid, cur)
  }
  const rows = [...map.entries()]
    .map(([cid, v]) => ({ cid, ...v, avg: v.n ? Math.round(v.sum / v.n) : 0 }))
    .sort((a, b) => b.avg - a.avg || a.label.localeCompare(b.label))
  if (rows.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {rows.map(r => (
        <li key={r.cid} className="flex items-center gap-2">
          <span className="w-20 shrink-0 truncate text-xs font-semibold">{r.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${r.avg}%`, background: r.avg >= 75 ? 'var(--c-success)' : r.avg > 0 ? 'var(--c-primary)' : 'var(--c-border-strong)' }} />
          </div>
          <span className="mono w-10 shrink-0 text-right text-[11px] font-bold">{r.avg}%</span>
          <span className="w-14 shrink-0 text-right text-[10px] text-muted">{r.n} peserta</span>
        </li>
      ))}
    </ul>
  )
}

export default function ReportLiveExam() {
  const { examId } = useParams()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [classId, setClassId] = useState('')
  const [extending, setExtending] = useState<Record<string, any> | null>(null)
  const [extraMinutes, setExtraMinutes] = useState(5)
  const [resetting, setResetting] = useState<Record<string, any> | null>(null)
  const [forcing, setForcing] = useState<Record<string, any> | null>(null)

  // Real-time via SSE (FR-9.3): snapshot → perbarui cache; filter ikut stream.
  const liveStatus = useLiveStream(
    '/reports/live/stream',
    { exam_id: examId ?? '', class_id: classId, q: search },
    data => { qc.setQueryData(['reports', 'live', examId], data) },
    !!examId,
  )

  const live = useQuery({
    queryKey: ['reports', 'live', examId],
    queryFn: async () => unwrap(await api(`/reports/live/${examId}`)),
    // polling jeda saat SSE hidup (FR-9.3 — hindari muat ganda)
    refetchInterval: liveStatus === 'live' ? false : 10_000,
  })

  const d = live.data ? asDict(live.data) : {}
  const exam = asDict(d.exam ?? {})
  const summary = asDict(d.summary ?? {})
  // Normalisasi kontrak backend: student_name/student_class/total_questions.
  const allStudents = asList(d.students ?? []).map(s => {
    const row: Record<string, unknown> = { ...s }
    row.name = s.name ?? s.student_name ?? 'Tanpa Nama'
    row.class = s.class ?? s.student_class ?? ''
    row.class_id = s.class_id ?? s.class ?? s.student_class ?? ''
    row.total = s.total ?? s.total_questions ?? 0
    row.attempt_no = Number(s.attempt_no ?? 1) || 1
    row.cheating = s.cheating ?? s.cheating_status ?? 'none'
    row.flagged = !['', 'none', '0', 'false', 'undefined', 'null'].includes(String(row.cheating ?? 'none'))
    return row
  })

  const classOptions = (() => {
    const seen = new Map<string, string>()
    for (const s of allStudents) {
      const cid = String(s.class_id ?? '')
      if (cid && !seen.has(cid)) seen.set(cid, String(s.class ?? cid))
    }
    return [...seen.entries()]
  })()

  const students = allStudents.filter(s =>
    (!classId || String(s.class_id ?? '') === classId) &&
    (!search || String(s.name ?? '').toLowerCase().includes(search.toLowerCase())))

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['reports', 'live', examId] })
    void qc.invalidateQueries({ queryKey: ['exams'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function extendTime() {
    if (!extending) return
    if (!(extraMinutes > 0)) { toast('Isi durasi tambahan (menit)', 'error'); return }
    setBusy(true)
    try {
      await send(`/exams/${exam.id}/participants/${extending.student_id}/extend-time`, { seconds: extraMinutes * 60 }, 'PUT')
      toast(`+${extraMinutes} menit untuk ${String(extending.name ?? 'siswa')}`, 'success')
      setExtending(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resetAttempt() {
    if (!resetting) return
    setBusy(true)
    try {
      await api(`/exams/${exam.id}/participants/${resetting.student_id}/reset-attempt`, { method: 'PUT' })
      toast(`Percobaan ${String(resetting.name ?? '')} direset — siswa bisa mengerjakan ulang`, 'success')
      setResetting(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function forceSubmit() {
    if (!forcing) return
    setBusy(true)
    try {
      await api(`/exams/${exam.id}/participants/${forcing.student_id}/force-submit`, { method: 'PUT' })
      toast(`${String(forcing.name ?? '')} dipaksa selesai`, 'success')
      setForcing(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const working = Number(summary.working ?? 0)
  const done = Number(summary.done ?? 0)
  const notStarted = Number(summary.not_started ?? 0)
  const total = Number(summary.total ?? 0)
  const participants = total || working + done + notStarted
  const ready = !live.isLoading && !live.isError
  const stat = (n: number) => (ready ? String(n) : '—')

  // indikator turunan dari baris peserta yang tampil (tanpa query tambahan)
  const onlineCount = students.filter(isOnline).length
  const violationTotal = students.reduce((acc, s) => acc + Number(s.violations ?? 0), 0)
  const reportedCount = students.filter(s => String(s.cheating ?? 'none') !== 'none').length

  if (live.isError) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Pantauan Real-time"
          title="Pantauan Live"
          icon={<IconChart2 size={18} />}
          action={<Link className="btn-ghost btn-sm" to="/reports/live"><IconLeft size={14} /> Semua live</Link>}
        />
        <Panel title="Data Pantauan" icon={<IconChart2 size={15} />}>
          <ErrorBox error={live.error} onRetry={() => void live.refetch()} />
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Pantauan Real-time"
        title={String(exam.name ?? 'Pantauan Live')}
        desc={String(exam.subject_name ?? '')}
        icon={<IconChart2 size={18} />}
        action={
          <>
            <LivePill status={liveStatus} fetching={live.isFetching} />
            <Link className="btn-ghost btn-sm" to="/reports/live"><IconLeft size={14} /> Semua live</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard label="Mengerjakan" value={stat(working)} hint="percobaan aktif" tone="primary" icon={<IconClock size={14} />} />
        <StatCard label="Selesai" value={stat(done)} hint="jawaban terkumpul" tone="success" icon={<IconCheck size={14} />} />
        <StatCard label="Belum mulai" value={stat(notStarted)} hint="belum membuka ujian" icon={<IconStudents size={14} />} />
        <StatCard label="Total peserta" value={stat(participants)} hint="sesuai penugasan ujian" icon={<IconChart2 size={14} />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* grafik progres: komposisi + histogram + per kelas (FR-9.2) */}
        <Panel title="Grafik Progres Peserta" icon={<IconChart2 size={15} />}>
          {live.isLoading ? (
            <SkeletonRows rows={4} cols={4} />
          ) : (
            <div className="space-y-4">
              <StatusStack working={working} done={done} notStarted={notStarted} participants={participants} />

              <div>
                <div className="section-label mb-1.5">Sebaran progres jawaban</div>
                <ProgressHistogram students={students} />
              </div>

              {(() => {
                const pcts = students.map(progressPct)
                const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0
                const fastest = students.reduce<Record<string, any> | null>((best, s) => {
                  if (progressPct(s) <= 0) return best
                  return !best || progressPct(s) > progressPct(best) ? s : best
                }, null)
                return (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    <div className="card !p-2.5">
                      <div className="section-label">Rata-rata progres</div>
                      <div className="mono text-lg font-bold leading-none">{avg}<span className="text-xs">%</span></div>
                      <div className="mt-1.5"><ProgressBar value={avg} /></div>
                    </div>
                    <div className="card !p-2.5">
                      <div className="section-label">Sudah 100%</div>
                      <div className="mono text-lg font-bold leading-none">
                        {pcts.filter(p => p >= 100).length}
                        <span className="text-xs">/{students.length}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">peserta menuntaskan semua soal</p>
                    </div>
                    <div className="card !p-2.5 sm:col-span-1 col-span-2">
                      <div className="section-label">Progres tercepat</div>
                      <div className="truncate text-sm font-bold">{String(fastest?.name ?? '—')}</div>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {fastest ? `${String(fastest.answered)} dari ${String(fastest.total)} soal terjawab` : 'menunggu peserta mulai'}
                      </p>
                    </div>
                  </div>
                )
              })()}

              {classOptions.length > 1 && (
                <div>
                  <div className="section-label mb-1.5">Rata-rata progres per kelas</div>
                  <ClassProgress students={students} />
                </div>
              )}

              <p className="hint">
                Grafik mengikuti filter kelas &middot; pencarian aktif — total peserta tampil{' '}
                <span className="mono font-semibold text-text">{students.length}</span>.
              </p>
            </div>
          )}
        </Panel>

        {/* indikator koneksi & kedisiplinan */}
        <Panel title="Indikator Peserta" icon={<IconShield size={15} />}>
          {live.isLoading ? (
            <SkeletonRows rows={2} cols={2} />
          ) : (
            <>
              <ul className="divide-y divide-border">
                <li className="flex items-center justify-between gap-2 py-2 first:pt-0">
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                    <IconWifi size={14} className="text-success" aria-hidden /> Online
                  </span>
                  <span className="mono text-sm font-bold">{onlineCount}</span>
                </li>
                <li className="flex items-center justify-between gap-2 py-2">
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                    <IconWifiOff size={14} className="text-danger" aria-hidden /> Offline
                  </span>
                  <span className="mono text-sm font-bold">{students.length - onlineCount}</span>
                </li>
                <li className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-muted">Pelanggaran tercatat</span>
                  <span className={`badge border ${violationTotal > 0 ? 'border-warn-line bg-warn-soft text-warn' : 'border-border bg-canvas text-muted'}`}>
                    <span className="mono">{violationTotal}×</span>
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 py-2 last:pb-0">
                  <span className="text-sm text-muted">Dilaporkan sistem</span>
                  <span className={`badge border ${reportedCount > 0 ? 'border-danger-line bg-danger-soft text-danger' : 'border-border bg-canvas text-muted'}`}>
                    <span className="mono">{reportedCount}</span> peserta
                  </span>
                </li>
              </ul>
              <p className="hint mt-2.5 border-t border-border pt-2">
                Dihitung dari baris peserta yang tampil — filter kelas dan pencarian ikut berlaku.
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* tabel siswa dengan status & aksi pengawas (FR-9.2, FR-9.4) */}
      <Panel
        title="Peserta"
        icon={<IconStudents size={15} />}
        flush
      >
        <div className="space-y-2.5 border-b border-border p-3">
          <Callout tone="info">
            Aksi pengawas (tambah waktu, reset, paksa selesai) langsung berlaku pada percobaan siswa.
          </Callout>
          <TableToolbar count={students.length} label="peserta">
            <SearchBox
              value={search}
              onChange={setSearch}
              label="Cari nama siswa"
              placeholder="Cari nama siswa…"
              className="w-full sm:w-52"
            />
            <select
              className="input sm:max-w-44"
              value={classId}
              onChange={e => setClassId(e.target.value)}
              aria-label="Filter kelas"
            >
              <option value="">Semua kelas</option>
              {classOptions.map(([cid, label]) => <option key={cid} value={cid}>{label}</option>)}
            </select>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => void live.refetch()}
              disabled={live.isFetching}
            >
              <IconRefresh size={13} /> Segarkan
            </button>
          </TableToolbar>
        </div>

        {live.isLoading ? (
          <div className="p-3"><SkeletonRows rows={4} cols={4} /></div>
        ) : students.length === 0 ? (
          <EmptyState icon={<IconStudents />} title="Tidak ada peserta pada filter ini">
            Longgarkan filter kelas atau ubah kata kunci pencarian.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Nama</th>
                  <th scope="col">Kelas</th>
                  <th scope="col">Progres</th>
                  <th scope="col">Status</th>
                  <th scope="col">Koneksi</th>
                  <th scope="col">Pelanggaran</th>
                  <th scope="col" className="num">Nilai</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, i) => {
                  const st = attemptStatus(s.status)
                  const online = isOnline(s)
                  const violations = Number(s.violations ?? 0)
                  const answered = Number(s.answered ?? 0)
                  const totalQ = Number(s.total ?? 0)
                  return (
                    <tr key={String(s.attempt_id ?? s.student_id ?? i)}>
                      <td data-th="Nama">
                        <div className="min-w-0">
                          <span className="block font-semibold">{String(s.name ?? '—')}</span>
                          {Number(s.attempt_no ?? 1) > 1 && (
                            <span className="mt-0.5 inline-flex badge border border-border bg-canvas text-muted">
                              percobaan {String(s.attempt_no)}
                            </span>
                          )}
                          {String(s.student_id ?? '') !== '' && (
                            <Link
                              className="btn-ghost btn-sm mt-1"
                              to={`/students/${String(s.student_id)}`}
                              title={`Buka track record ${String(s.name ?? '')}`}
                            >
                              <IconHistory size={13} /> Track record
                            </Link>
                          )}
                        </div>
                      </td>
                      <td data-th="Kelas">{String(s.class ?? '—')}</td>
                      <td data-th="Progres">
                        <div className="flex flex-col items-end gap-1 sm:items-start">
                          <span className="mono text-xs font-semibold">{answered}/{totalQ}</span>
                          <div className="w-24 sm:w-28">
                            <ProgressBar value={answered} max={Math.max(1, totalQ)} label={`Progres ${String(s.name ?? 'siswa')}`} />
                          </div>
                        </div>
                      </td>
                      <td data-th="Status">
                        <span className={`badge border ${softLine(st.cls)} ${st.cls}`}>{st.label}</span>
                      </td>
                      <td data-th="Koneksi">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${online ? 'text-success' : 'text-danger'}`}>
                          {online ? <IconWifi size={14} aria-hidden /> : <IconWifiOff size={14} aria-hidden />}
                          {online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td data-th="Pelanggaran">
                        <div className="flex flex-wrap items-center justify-end gap-1 sm:justify-start">
                          {violations > 0 ? (
                            <span className={`badge border ${violations >= 3 ? 'border-danger-line bg-danger-soft text-danger' : 'border-warn-line bg-warn-soft text-warn'}`}>
                              <span className="mono">{violations}×</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                          {Boolean(s.flagged) && (
                            <span className="badge border border-danger-line bg-danger-soft text-danger">dilaporkan curang</span>
                          )}
                        </div>
                      </td>
                      <td data-th="Nilai" className="num font-semibold">
                        {s.score !== undefined && s.score !== null ? String(s.score)
                          : s.final_score !== undefined && s.final_score !== null ? String(s.final_score) : '—'}
                      </td>
                      <td data-th="Aksi">
                        <div className="flex flex-wrap justify-end gap-1.5 sm:justify-start">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => { setExtraMinutes(5); setExtending(s) }}>
                            + Waktu
                          </button>
                          <button type="button" className="btn-quiet btn-sm" onClick={() => setResetting(s)}>Reset</button>
                          <button type="button" className="btn-quiet btn-sm !text-danger" onClick={() => setForcing(s)}>
                            Paksa selesai
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={!!extending}
        onClose={() => setExtending(null)}
        title={`Tambah waktu — ${String(extending?.name ?? '')}`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setExtending(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void extendTime()} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Tambah waktu'}
            </button>
          </>
        }
      >
        <div>
          <label className="label" htmlFor="lv-min">Tambahan waktu (menit)</label>
          <input
            id="lv-min"
            type="number"
            min={1}
            step={1}
            className="input"
            value={extraMinutes}
            onChange={e => setExtraMinutes(Number(e.target.value) || 0)}
          />
          <p className="hint mt-1">
            Durasi dikirim ke server: <span className="mono font-semibold text-text">{extraMinutes * 60}</span> detik
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!resetting} title="Reset percobaan?" busy={busy}
        message={`Percobaan ${resetting?.name ?? ''} dihapus & siswa mengerjakan ulang dari awal.`}
        confirmLabel="Ya, reset"
        onConfirm={resetAttempt} onClose={() => setResetting(null)}
      />
      <ConfirmDialog
        open={!!forcing} title="Paksa selesai?" danger busy={busy} confirmLabel="Ya, paksa selesai"
        message={`Jawaban ${forcing?.name ?? ''} dikumpulkan sekarang apa adanya.`}
        onConfirm={forceSubmit} onClose={() => setForcing(null)}
      />
    </div>
  )
}
