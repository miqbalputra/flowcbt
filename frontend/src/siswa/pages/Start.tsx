// Mulai ujian: tata tertib + token + persetujuan + PRA-MUAT paket ke IndexedDB
// (FR-7.2). Urutan tahap progres JUJUR (server → save → done), tidak bisa dilewati.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { saveAttempt } from '../db'
import { examDetail, startExam } from '../lib/student-api'
import { errMessage, getProfile } from '../lib/util'
import { SiswaLayout } from '../components/SiswaLayout'
import { toast } from '@/components/toast'
import type { AttemptRecord, AttemptPackage, FetchedQuestion } from '../types'

type RuleItem = { title: string; body: string; forbidden: boolean }

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

  async function submit() {
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
        exam_code: (detail?.exam_code as string) ?? (pack.exam_code as string) ?? '',
        subject_name: (pack.subject_name as string) ?? '',
        questions: (pack.questions ?? []) as FetchedQuestion[],
        deadline_at: res.deadline_at,
        server_offset: res.server_offset_ms,
        started_at: res.started_at,
        status: 'in_progress',
        profile: getProfile(),
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
          <p role="alert" className="text-sm" style={{ color: 'var(--c-warn)' }}>
            Detail ujian gagal dimuat — periksa koneksimu.
          </p>
        )}

        <div>
          <label className="label" htmlFor="tk">Token ujian</label>
          <input
            id="tk"
            className="input font-mono tracking-widest uppercase"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="XXXXXXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </div>

        <label className="flex min-h-11 items-start gap-2 text-sm leading-relaxed">
          <input type="checkbox" className="mt-1 shrink-0" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span>Saya sudah membaca dan setuju dengan tata tertib ujian.</span>
        </label>
        {(detail?.camera_enabled ?? false) && (
          <label className="flex min-h-11 items-start gap-2 text-sm leading-relaxed">
            <input type="checkbox" className="mt-1 shrink-0" checked={camOk} onChange={e => setCamOk(e.target.checked)} />
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

        <button type="button" className="btn-primary w-full text-base" style={{ minHeight: 52 }} disabled={busy || !agree} onClick={submit}>
          {busy ? 'Memproses…' : 'Mulai Ujian'}
        </button>
        <Link to="/s/exams" className="btn-ghost w-full text-center">Batal</Link>
      </div>
    </SiswaLayout>
  )
}

/** Daftar tata tertib rapi: border kiri 3px merah (larangan) / biru (info).
 * Sumber tetap fleksibel: array terstruktur ATAU teks per-baris dari guru. */
function Rules({ detail }: { detail: Record<string, unknown> | null }) {
  const raw = detail?.rules_text as string | Array<{ title: string; body: string }> | undefined
  const items: RuleItem[] = Array.isArray(raw)
    ? raw.map(r => ({ title: r.title, body: r.body, forbidden: isForbidden(r.title + ' ' + r.body) }))
    : String(raw ?? 'Kerjakan mandiri; jangan keluar aplikasi secara berlebihan.')
        .split('\n')
        .filter(l => l.trim())
        .map(line0 => {
          const text = line0.replace(/^(\s*[-•*]|\s*\d+[.)])\s*/, '').trim()
          const [head, ...rest] = text.split(' — ')
          return {
            title: rest.length ? head.trim() : '',
            body: rest.length ? rest.join(' — ') : text,
            forbidden: isForbidden(text),
          }
        })
  return (
    <section aria-label="Tata tertib ujian">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted" aria-hidden>
          <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
        Tata tertib ujian
      </h2>
      <ul className="space-y-2">
        {items.length === 0 && (
          <li className="text-sm text-muted">Tidak ada ketentuan khusus — kerjakan mandiri.</li>
        )}
        {items.map((r, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm leading-relaxed"
            style={{ borderLeft: `3px solid ${r.forbidden ? 'var(--c-danger)' : 'var(--c-primary)'}` }}
          >
            <span
              aria-hidden
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm font-mono text-[11px] font-bold text-white"
              style={{ background: r.forbidden ? 'var(--c-danger)' : 'var(--c-primary)' }}
            >
              {r.forbidden ? '✕' : 'i'}
            </span>
            <span className="min-w-0">
              {r.title && <strong className="mr-1">{r.title}:</strong>}
              {r.body}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Deteksi kasar butir larangan (non-blocking, hanya menentukan warna). */
function isForbidden(text: string): boolean {
  return /(jangan|dilarang|tidak boleh|forbidden)/i.test(text)
}
