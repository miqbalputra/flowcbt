// Dashboard siswa (/s/exams) — daftar ujian + tombol Mulai/Lanjutkan per ujian.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { errMessage, fmtDateTime } from '../lib/util'
import { toast } from '@/components/toast'
import { SiswaLayout } from '../components/SiswaLayout'
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

  return (
    <SiswaLayout title="Ujianku">
      {loading && <SkeletonList />}
      {err && (
        <div className="card !border-danger text-sm">
          <p className="font-semibold text-danger">Gagal memuat daftar ujian</p>
          <p className="text-muted mt-1">{err}</p>
          <button className="btn-ghost mt-2" onClick={() => window.location.reload()}>Coba lagi</button>
        </div>
      )}
      {!loading && !err && (
        <div className="space-y-6">
          <Section title="Sedang dibuka" items={exams.open} />
          <Section title="Akan datang" items={exams.upcoming} />
          <Section title="Selesai" items={exams.done} />
        </div>
      )}
    </SiswaLayout>
  )
}

function Section({ title, items }: { title: string; items: StudentExam[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{title}</h2>
      {items.length === 0 && <p className="text-sm text-muted">Belum ada.</p>}
      <ul className="space-y-2">
        {items.map(x => (
          <ExamCard key={x.id} exam={x} />
        ))}
      </ul>
    </section>
  )
}

function ExamCard({ exam }: { exam: StudentExam }) {
  const nav = useNavigate()
  const btn = exam.status === 'open' ? 'Mulai' : 'Lihat'
  return (
    <li className="card space-y-1">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug">{exam.name}</h3>
        {typeof exam.score === 'number' && (
          <span className="badge bg-success text-white shrink-0">Nilai {exam.score}</span>
        )}
      </div>
      <p className="text-xs text-muted">
        {exam.subject_name ?? '—'} · {fmtDateTime(exam.open_at)} → {fmtDateTime(exam.close_at)}
      </p>
      <button
        className="btn-primary mt-2 w-full"
        onClick={() => nav(`/s/exams/${exam.id}/start`)}
      >
        {btn}
      </button>
    </li>
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
