// Dashboard peserta (/s/exams) — "Ayo Ujian": ringkasan status, filter mapel,
// daftar ujian gaya portal (kartu baris + rel status) dan panel petunjuk.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { errMessage, fmtDateTime } from '../lib/util'
import { myExams } from '../lib/student-api'
import { SiswaLayout, Panel, EmptyState } from '../components/SiswaLayout'
import { Tabs } from '@/guru/ui'
import {
  IconCheck, IconClock, IconExam, IconPlay, IconRight, IconSearch,
  IconShield, IconStudents, IconTrophy, IconAlertCircle,
} from '@/components/icons'
import type { StudentExam } from '../types'

type Bucket = { open: StudentExam[]; upcoming: StudentExam[]; done: StudentExam[] }
const EMPTY: Bucket = { open: [], upcoming: [], done: [] }

export default function Dashboard() {
  const [data, setData] = useState<Bucket>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState('')
  const [tab, setTab] = useState<'all' | 'open' | 'upcoming' | 'done'>('all')

  useEffect(() => {
    let alive = true
    myExams()
      .then(d => {
        if (!alive) return
        setData({ open: d.open ?? [], upcoming: d.upcoming ?? [], done: d.done ?? [] })
        setLoading(false)
      })
      .catch(e => {
        setErr(errMessage(e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const subjects = useMemo(() => {
    const set = new Set<string>()
    for (const x of [...data.open, ...data.upcoming, ...data.done]) if (x.subject_name) set.add(x.subject_name)
    return [...set].sort((a, b) => a.localeCompare(b, 'id'))
  }, [data])

  const list = useMemo(() => {
    const base =
      tab === 'open' ? data.open : tab === 'upcoming' ? data.upcoming : tab === 'done' ? data.done : [...data.open, ...data.upcoming, ...data.done]
    const needle = q.trim().toLowerCase()
    return base.filter(x => {
      if (subject && x.subject_name !== subject) return false
      if (!needle) return true
      return [x.name, x.subject_name, x.exam_code].some(v => String(v ?? '').toLowerCase().includes(needle))
    })
  }, [data, tab, q, subject])

  const total = data.open.length + data.upcoming.length + data.done.length
  const toneOf = (x: StudentExam) => (data.open.includes(x) ? 'open' : data.upcoming.includes(x) ? 'upcoming' : 'done')

  return (
    <SiswaLayout title="Ayo Ujian" subtitle="Daftar ujian yang ditugaskan untukmu" width="lg" titleIcon={<IconExam size={17} />}>
      {/* ringkasan status */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <SummaryTile label="Tersedia" value={data.open.length} tone="primary" icon={<IconPlay size={14} />} />
        <SummaryTile label="Terjadwal" value={data.upcoming.length} tone="muted" icon={<IconClock size={14} />} />
        <SummaryTile label="Selesai" value={data.done.length} tone="success" icon={<IconCheck size={14} />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_286px]">
        <div className="min-w-0 space-y-3">
          <Panel
            title="Daftar Ujian"
            icon={<IconExam size={15} />}
            action={
              <span className="mono rounded border border-border bg-canvas px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                {list.length} ujian
              </span>
            }
            flush
          >
            {/* filter */}
            <div className="space-y-2.5 border-b border-border px-3 py-2.5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="search"
                    className="input pl-9"
                    placeholder="Cari nama ujian, mapel, atau kode…"
                    aria-label="Cari ujian"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                  />
                </div>
                <select
                  className="input sm:w-60"
                  aria-label="Filter mata pelajaran"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                >
                  <option value="">Semua mata pelajaran</option>
                  {subjects.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <Tabs
                ariaLabel="Status ujian"
                value={tab}
                onChange={k => setTab(k as typeof tab)}
                items={[
                  { key: 'all', label: 'Semua', count: total },
                  { key: 'open', label: 'Dibuka', count: data.open.length },
                  { key: 'upcoming', label: 'Terjadwal', count: data.upcoming.length },
                  { key: 'done', label: 'Selesai', count: data.done.length },
                ]}
              />
            </div>

            {loading ? (
              <div className="space-y-2 p-3" aria-label="Memuat daftar ujian">
                {[0, 1, 2].map(i => <div key={i} className="skeleton h-[76px] w-full" />)}
              </div>
            ) : err ? (
              <div className="p-3">
                <div className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-soft p-3 text-sm">
                  <IconAlertCircle size={17} className="mt-0.5 shrink-0 text-danger" />
                  <div>
                    <p className="font-semibold text-danger">Gagal memuat daftar ujian</p>
                    <p className="mt-0.5 text-muted">{err}</p>
                    <button className="btn-ghost btn-sm mt-2" onClick={() => window.location.reload()}>Coba lagi</button>
                  </div>
                </div>
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                title={total === 0 ? 'Belum ada ujian' : 'Tidak ada ujian yang cocok'}
                hint={total === 0 ? 'Ujian dari gurumu akan muncul di sini setelah dipublikasikan.' : 'Ubah kata kunci atau filter status.'}
              />
            ) : (
              <ul className="divide-y divide-border">
                {list.map(x => <ExamRow key={x.id} exam={x} tone={toneOf(x)} />)}
              </ul>
            )}
          </Panel>

          <p className="px-1 text-[11px] leading-relaxed text-muted">
            Semua waktu mengikuti zona waktu sekolah. Tombol <b>Mulai</b> hanya aktif di dalam rentang jadwal ujian.
          </p>
        </div>

        {/* panel petunjuk */}
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <Panel title="Petunjuk Peserta" icon={<IconShield size={15} />}>
            <ol className="space-y-2.5">
              {[
                'Pilih ujian yang berstatus Dibuka.',
                'Masukkan token dari pengawas, baca tata tertib, lalu mulai.',
                'Jawaban tersimpan otomatis — tetap aman saat koneksi putus.',
                'Tekan Selesai, periksa ringkasan, lalu kirim.',
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed">
                  <span className="mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-canvas text-[10px] font-bold text-muted">
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ol>
            <div className="mt-3 flex items-start gap-2 rounded border border-primary-line bg-primary-soft p-2.5 text-[11.5px] leading-relaxed text-text">
              <IconStudents size={14} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Tidak punya akun? Gunakan <b className="font-semibold">Masuk tamu</b> dengan kode ujian + token.
              </span>
            </div>
          </Panel>

          <Panel title="Butuh bantuan?" icon={<IconAlertCircle size={15} />}>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Hubungi pengawas di ruang ujian atau guru mata pelajaran. Sertakan nama, kelas, dan kode ujian agar cepat ditangani.
            </p>
          </Panel>
        </div>
      </div>
    </SiswaLayout>
  )
}

function SummaryTile({ label, value, tone, icon }: { label: string; value: number; tone: 'primary' | 'muted' | 'success'; icon: React.ReactNode }) {
  const map = {
    primary: 'border-primary-line bg-primary-soft text-primary',
    muted: 'border-border bg-surface text-muted',
    success: 'border-success-line bg-success-soft text-success',
  }[tone]
  return (
    <div className={`rounded-md border p-2.5 sm:p-3 ${map}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.07em]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mono mt-1 text-xl font-bold leading-none text-text sm:text-2xl">{value}</div>
    </div>
  )
}

function ExamRow({ exam, tone }: { exam: StudentExam; tone: 'open' | 'upcoming' | 'done' }) {
  const nav = useNavigate()
  const canStart = tone === 'open'
  const resuming = Boolean(exam.active_attempt_id)
  const rail = tone === 'open' ? 'var(--c-primary)' : tone === 'done' ? 'var(--c-success-bg)' : 'var(--c-border-strong)'
  const status =
    tone === 'open'
      ? { label: 'Dibuka', cls: 'border-primary-line bg-primary-soft text-primary' }
      : tone === 'done'
        ? { label: 'Selesai', cls: 'border-success-line bg-success-soft text-success' }
        : { label: 'Terjadwal', cls: 'border-border bg-canvas text-muted' }
  const score = typeof exam.score === 'number' ? exam.score : exam.best_score

  return (
    <li className="relative px-3 py-3 transition-colors hover:bg-canvas/60">
      <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r" style={{ background: rail }} />
      <div className="flex flex-col gap-2.5 pl-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`badge border ${status.cls}`}>{status.label}</span>
            {exam.exam_code && <span className="chip mono">{exam.exam_code}</span>}
            {exam.subject_name && <span className="chip">{exam.subject_name}</span>}
          </div>
          <h3 className="mt-1 truncate text-[14px] font-semibold leading-snug">{exam.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1"><IconClock size={12} /> {fmtDateTime(exam.open_at)}</span>
            {exam.duration_minutes ? <span className="mono">{exam.duration_minutes} menit</span> : null}
            {(() => {
              const used = Number(exam.attempts_used ?? 0)
              const max = Number(exam.max_attempts ?? 0)
              return max > 0 ? <span className="mono">percobaan {used}/{max}</span> : <span>percobaan bebas</span>
            })()}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          {typeof score === 'number' && (
            <span className="badge border border-success-line bg-success-soft text-success">
              <IconTrophy size={11} /> Nilai <span className="mono font-bold">{score}</span>
            </span>
          )}
          <button
            type="button"
            className={`btn btn-sm ${canStart ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() =>
              nav(resuming ? `/s/attempt/${exam.active_attempt_id}` : `/s/exams/${exam.id}/start`)
            }
          >
            {canStart ? <IconPlay size={13} /> : <IconRight size={13} />}
            {canStart ? (resuming ? 'Lanjutkan' : 'Mulai') : tone === 'done' ? 'Lihat' : 'Detail'}
          </button>
        </div>
      </div>
    </li>
  )
}
