// Dashboard siswa (/s/exams) — daftar ujian dgn ikon section, strip status
// 3px, kode ujian mono, tombol Mulai/Lanjutkan ber-ikon. Tanpa emoji.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { errMessage, fmtDateTime } from '../lib/util'
import { SiswaLayout, EmptyState } from '../components/SiswaLayout'
import { IconCheck, IconClock, IconExam, IconPlay, IconRight } from '@/components/icons'
import type { StudentExam } from '../types'

export default function Dashboard() {
  const [exams, setExams] = useState<{ open: StudentExam[]; upcoming: StudentExam[]; done: StudentExam[] }>({
    open: [],
    upcoming: [],
    done: [],
  })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    api<unknown>('/student/me/exams')
      .then(d => {
        if (!alive) return
        const o = d as { open?: StudentExam[]; upcoming?: StudentExam[]; done?: StudentExam[] }
        setExams({ open: o.open ?? [], upcoming: o.upcoming ?? [], done: o.done ?? [] })
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

  const total = exams.open.length + exams.upcoming.length + exams.done.length

  return (
    <SiswaLayout title="Ujianku">
      {loading && <SkeletonList />}
      {err && (
        <div className="card text-sm" style={{ borderColor: 'var(--c-danger)' }} role="alert">
          <p className="font-semibold text-danger">Gagal memuat daftar ujian</p>
          <p className="mt-1 text-muted">{err}</p>
          <button className="btn-ghost mt-3" onClick={() => window.location.reload()}>Coba lagi</button>
        </div>
      )}
      {!loading && !err && (total === 0 ? (
        <EmptyState title="Belum ada ujian" hint="Daftar ujian dari gurumu akan muncul di sini setelah dipublikasikan." />
      ) : (
        <div className="space-y-6">
          <Section title="Ujian tersedia" items={exams.open} tone="primary" icon={<IconExam size={14} />} />
          <Section title="Akan datang" items={exams.upcoming} tone="muted" icon={<IconClock size={14} />} />
          <Section title="Selesai" items={exams.done} tone="success" icon={<IconCheck size={14} />} />
        </div>
      ))}
    </SiswaLayout>
  )
}

function Section({
  title,
  items,
  tone,
  icon,
}: {
  title: string
  items: StudentExam[]
  tone: 'primary' | 'muted' | 'success'
  icon?: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {icon && icon}
        {title}
        <span className="rounded border border-border bg-canvas px-1.5 font-mono text-[11px] font-bold text-text">{items.length}</span>
      </h2>
      {items.length === 0 && <p className="text-sm text-muted">Belum ada.</p>}
      <ul className="space-y-2">
        {items.map(x => (
          <ExamCard key={x.id} exam={x} tone={tone} />
        ))}
      </ul>
    </section>
  )
}

const TONE_COLOR: Record<'primary' | 'muted' | 'success', string> = {
  primary: 'var(--c-primary)',
  muted: 'var(--c-border-strong)',
  success: 'var(--c-success)',
}

function ExamCard({ exam, tone }: { exam: StudentExam; tone: 'primary' | 'muted' | 'success' }) {
  const nav = useNavigate()
  const canStart = tone === 'primary'
  const label = canStart ? (exam.active_attempt_id ? 'Lanjutkan' : 'Mulai') : 'Lihat'
  return (
    <li
      className="card flex items-center justify-between gap-3 !p-3"
      style={{ borderLeft: `3px solid ${TONE_COLOR[tone]}` }}
    >
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold leading-snug">{exam.name}</h3>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          {exam.exam_code && (
            <span className="shrink-0 font-mono text-xs text-muted" title="Kode ujian">
              {exam.exam_code}
            </span>
          )}
          {exam.exam_code && <span aria-hidden>·</span>}
          {(exam.subject_name || 'Umum') + ' · ' + fmtDateTime(exam.open_at)}
        </p>
        <div className="mt-1">
          <ScheduleBadge exam={exam} tone={tone} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {typeof exam.score === 'number' && (
          <span
            className="badge border"
            style={{ background: 'var(--c-success-soft)', color: 'var(--c-success)', borderColor: 'var(--c-success)' }}
          >
            Nilai <span className="font-mono font-bold">{exam.score}</span>
          </span>
        )}
        <button
          className="btn-primary btn-sm shrink-0"
          style={canStart ? undefined : { background: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border-strong)' }}
          onClick={() => nav(`/s/exams/${exam.id}/start`)}
        >
          {canStart ? <IconPlay size={14} /> : <IconRight size={14} />}
          {label}
        </button>
      </div>
    </li>
  )
}

function ScheduleBadge({ exam, tone }: { exam: StudentExam; tone: 'primary' | 'muted' | 'success' }) {
  const style =
    tone === 'primary'
      ? { background: 'var(--c-primary-soft)', color: 'var(--c-primary)', borderColor: 'var(--c-primary)' }
      : tone === 'success'
        ? { background: 'var(--c-success-soft)', color: 'var(--c-success)', borderColor: 'var(--c-success)' }
        : { background: 'var(--c-canvas)', color: 'var(--c-muted)', borderColor: 'var(--c-border-strong)' }
  const label =
    tone === 'primary' ? 'Dibuka' : tone === 'success' ? 'Selesai' : 'Terjadwal'
  return (
    <span className="badge shrink-0 border" style={style}>
      {label}
      {exam.duration_minutes ? (
        <span className="font-mono" title="Durasi">
          · {exam.duration_minutes} menit
        </span>
      ) : null}
    </span>
  )
}

function SkeletonList() {
  return (
    <ul className="space-y-2" aria-label="Memuat…">
      {[0, 1, 2].map(i => (
        <li key={i} className="skeleton h-20 w-full" />
      ))}
    </ul>
  )
}
