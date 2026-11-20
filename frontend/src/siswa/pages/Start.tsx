// Mulai ujian: token + tata tertib + persetujuan + PRA-MUAT paket ke IndexedDB.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { saveAttempt } from '../db'
import { examDetail, startExam } from '../lib/student-api'
import { errMessage } from '../lib/util'
import { SiswaLayout } from '../components/SiswaLayout'
import { toast } from '@/components/toast'
import type { AttemptRecord, AttemptPackage, FetchedQuestion } from '../types'

/** Tahap pra-muat nyata: server → simpan IndexedDB (FR-7.2). */
type LoadStage = 'idle' | 'server' | 'save' | 'done'

const STAGE_PCT: Record<LoadStage, number> = { idle: 0, server: 10, save: 65, done: 100 }
const STAGE_LABEL: Record<LoadStage, string> = {
  idle: '',
  server: 'Mengambil paket soal dari server…',
  save: 'Menyimpan paket soal ke perangkat…',
  done: 'Paket siap — memulai ujian…',
}

export default function Start() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [detailErr, setDetailErr] = useState(false)
  const [token, setToken] = useState('')
  const [agree, setAgree] = useState(false)
  const [camOk, setCamOk] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<LoadStage>('idle')

  useEffect(() => {
    let alive = true
    examDetail(id)
      .then(d => {
        if (!alive) return
        setDetail(d)
        setDetailErr(false)
      })
      .catch(() => {
        // gagal muat → beri tahu siswa, jangan senyap (tombol lanjut tetap ada)
        if (!alive) return
        setDetail(null)
        setDetailErr(true)
      })
    return () => {
      alive = false
    }
  }, [id])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!agree) return
    setBusy(true)
    setErr('')
    try {
      // Tahap 1 — unduh paket dari server (waktu dinormalisasi ke epoch ms).
      setStage('server')
      const res = await startExam(id, token.trim())
      const pack = (res.package ?? ({} as AttemptPackage)) as AttemptPackage
      // Tahap 2 — simpan paket ke IndexedDB.
      setStage('save')
      const rec: AttemptRecord = {
        attempt_id: res.attempt_id,
        exam_name: (pack.name as string) ?? 'Ujian',
        subject_name: (pack.subject_name as string) ?? '',
        questions: (pack.questions ?? []) as FetchedQuestion[],
        deadline_at: res.deadline_at,
        server_offset: res.server_offset_ms,
        started_at: res.started_at,
        status: 'in_progress',
        profile: undefined,
      }
      await saveAttempt(rec)
      // Tahap 3 — selesai.
      setStage('done')
      nav(`/s/attempt/${res.attempt_id}`)
    } catch (er) {
      setErr(errMessage(er))
      setStage('idle')
      setBusy(false)
    }
  }

  return (
    <SiswaLayout title="Mulai ujian">
      <div className="card space-y-4">
        <Rules detail={detail} />
        {detailErr && (
          <p role="alert" className="text-sm text-warn">
            Detail ujian gagal dimuat — periksa koneksimu.
          </p>
        )}
        <div>
          <label className="label" htmlFor="tk">Token ujian</label>
          <input id="tk" className="input" value={token} onChange={e => setToken(e.target.value)} required />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span>Saya sudah membaca dan setuju dengan tata tertib ujian.</span>
        </label>
        {(detail?.camera_enabled ?? false) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={camOk} onChange={e => setCamOk(e.target.checked)} />
            <span>Saya mengizinkan kamera untuk proctoring selama ujian.</span>
          </label>
        )}
        {busy && (
          <div aria-busy="true">
            <progress value={STAGE_PCT[stage]} max={100} className="w-full" />
            <p className="mt-1 text-xs text-muted" role="status">{STAGE_LABEL[stage]}</p>
          </div>
        )}
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <button type="button" className="btn-primary w-full" disabled={busy || !agree} onClick={submit}>
          {busy ? 'Memproses…' : 'Mulai'}
        </button>
        <Link to="/s/exams" className="btn-ghost w-full text-center">Batal</Link>
      </div>
    </SiswaLayout>
  )
}

function Rules({ detail }: { detail: Record<string, unknown> | null }) {
  const rules = detail?.rules_text as string | Array<{ title: string; body: string }> | undefined
  if (Array.isArray(rules)) {
    return (
      <div className="space-y-2 text-sm">
        {rules.map((r, i) => (
          <p key={i}>
            <strong>{r.title}</strong> — {r.body}
          </p>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">Tata tertib ujian</p>
      <p className="whitespace-pre-wrap text-muted">{(rules as string) ?? 'Kerjakan mandiri; jangan keluar aplikasi berlebihan.'}</p>
    </div>
  )
}
