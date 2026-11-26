// Mulai ujian — halaman konfirmasi gaya portal ujian: identitas ujian di kiri,
// token + tata tertib + persetujuan di kanan. Alur pra-muat TIDAK berubah
// (FR-7.2: server → simpan IndexedDB → buka runner).
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { saveAttempt } from '../db'
import { examDetail, getServerAttempt, startExam } from '../lib/student-api'
import { errMessage, fmtDateTime, getProfile, lastExamToken } from '../lib/util'
import { SiswaLayout, Panel, MetaRow, TextField } from '../components/SiswaLayout'
import { toast } from '@/components/toast'
import {
  IconAlertCircle, IconCheck, IconClipboard, IconClock, IconExam, IconInfo,
  IconKey, IconShield, IconStudents, IconWarn,
} from '@/components/icons'
import type { AttemptRecord, AttemptPackage, FetchedQuestion } from '../types'

type LoadStage = 'idle' | 'server' | 'save' | 'done'
const STAGE_PCT: Record<LoadStage, number> = { idle: 0, server: 12, save: 65, done: 100 }
const STAGE_LABEL: Record<LoadStage, string> = {
  idle: '',
  server: 'Mengambil paket soal dari server…',
  save: 'Menyimpan paket soal ke perangkat…',
  done: 'Paket siap — memulai ujian…',
}

type RulesCfg = {
  anti_cheat_enabled?: boolean
  tolerance_seconds?: number
  penalty_points?: number
  max_penalty?: number
  flag_threshold?: number
  auto_submit?: boolean
  camera_enabled?: boolean
  camera_required?: boolean
}

export default function Start() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [detailErr, setDetailErr] = useState(false)
  const [token, setToken] = useState(() => lastExamToken())
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
        if (!alive) return
        setDetail(null)
        setDetailErr(true)
      })
    return () => {
      alive = false
    }
  }, [id])

  const rules = (detail?.rules ?? {}) as RulesCfg
  const cameraOn = Boolean(rules.camera_enabled ?? detail?.camera_enabled)
  const cameraRequired = Boolean(rules.camera_required)
  const attemptsUsed = Number(detail?.attempts_used ?? 0)
  const maxAttempts = Number(detail?.max_attempts ?? 0)

  const tokenOk = token.trim().length >= 4

  async function submit() {
    if (!agree) return
    if (!tokenOk) {
      setErr('Masukkan token ujian yang diberikan pengawas (4–12 karakter).')
      return
    }
    if (cameraRequired && cameraOn && !camOk) {
      setErr('Kamera wajib diizinkan untuk ujian ini. Centang persetujuan kamera terlebih dahulu.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      setStage('server')
      const res = await startExam(id, token.trim())
      const pack = (res.package ?? ({} as AttemptPackage)) as AttemptPackage
      // Resume lama (atau server tanpa paket): ambil soal dari view attempt.
      let questions = (pack.questions ?? []) as FetchedQuestion[]
      if (questions.length === 0 && res.attempt_id) {
        try {
          const view = await getServerAttempt(res.attempt_id)
          questions = (view.package?.questions ?? []) as FetchedQuestion[]
        } catch {
          /* offline-first: IDB kosong → halaman Attempt akan memulihkan sendiri */
        }
      }
      setStage('save')
      const rec: AttemptRecord = {
        attempt_id: res.attempt_id,
        exam_name: (pack.name as string) ?? 'Ujian',
        exam_code: (detail?.exam_code as string) ?? (pack.exam_code as string) ?? '',
        subject_name: (pack.subject_name as string) ?? '',
        questions,
        deadline_at: res.deadline_at,
        server_offset: res.server_offset_ms,
        started_at: res.started_at,
        status: 'in_progress',
        profile: getProfile(),
      }
      await saveAttempt(rec)
      setStage('done')
      nav(`/s/attempt/${res.attempt_id}`)
    } catch (er) {
      const msg = errMessage(er)
      setErr(
        /validasi|validation|required/i.test(msg)
          ? 'Token tidak valid atau belum diisi. Periksa kembali token dari pengawas.'
          : msg,
      )
      setStage('idle')
      setBusy(false)
    }
  }

  return (
    <SiswaLayout
      title="Konfirmasi Ujian"
      subtitle={String(detail?.name ?? 'Persiapan sebelum mulai')}
      titleIcon={<IconExam size={17} />}
      width="lg"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* ---------------- identitas ujian ---------------- */}
        <div className="space-y-4">
          <Panel title="Identitas Ujian" icon={<IconClipboard size={15} />}>
            <h2 className="text-base font-bold leading-snug">{String(detail?.name ?? 'Ujian')}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {String(detail?.subject_name ?? 'Mata pelajaran')} · Kode{' '}
              <span className="mono font-semibold text-text">{String(detail?.exam_code ?? '—')}</span>
            </p>
            <dl className="mt-3">
              <MetaRow label="Jadwal buka" value={fmtDateTime(detail?.open_at as string)} />
              <MetaRow label="Jadwal tutup" value={fmtDateTime(detail?.close_at as string)} />
              <MetaRow label="Durasi pengerjaan" value={`${Number(detail?.duration_minutes ?? 0)} menit`} mono />
              <MetaRow label="Jumlah soal" value={`${Number(detail?.question_count ?? 0)} butir`} mono />
              <MetaRow label="Total poin" value={String(detail?.total_points ?? '—')} mono />
              <MetaRow
                label="Percobaan"
                value={maxAttempts > 0 ? `${attemptsUsed} dari ${maxAttempts}` : `${attemptsUsed} (tak terbatas)`}
                mono
              />
              <MetaRow
                label="Navigasi"
                value={detail?.free_navigation === false ? 'Satu arah (tidak bisa kembali)' : 'Bebas'}
              />
            </dl>
          </Panel>

          <div className="rounded-md border border-primary-line bg-primary-soft p-3 text-[13px] leading-relaxed">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-primary">
              <IconInfo size={15} /> Sebelum menekan Mulai
            </div>
            <ul className="list-disc space-y-1 pl-5 text-text">
              <li>Pastikan perangkat terhubung internet — paket soal diunduh sekali di awal.</li>
              <li>Setelah paket tersimpan, pengerjaan tetap berjalan walau koneksi terputus.</li>
              <li>Jangan menutup atau menghapus data peramban selama ujian berlangsung.</li>
              <li>Waktu dihitung server sejak kamu menekan Mulai.</li>
            </ul>
          </div>
        </div>

        {/* ---------------- token + tata tertib ---------------- */}
        <div className="space-y-4">
          <Panel
            title="Token Ujian"
            icon={<IconKey size={15} />}
            footer={
              <p className="text-[11px] leading-snug text-muted">
                Token diberikan pengawas di ruang ujian. Token salah akan ditolak server.
              </p>
            }
          >
            <TextField
              id="tk"
              label="Masukkan token"
              icon={<IconKey size={17} />}
              mono
              value={token}
              onChange={e => setToken(e.target.value.toUpperCase())}
              placeholder="••••••"
              autoComplete="off"
              autoCapitalize="characters"
              required
              hint={
                tokenOk
                  ? 'Token diterima. Tidak peka huruf besar/kecil.'
                  : 'Wajib diisi — 4–12 karakter, tidak peka huruf besar/kecil.'
              }
            />
            {detailErr && (
              <p role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] text-warn">
                <IconWarn size={14} className="mt-0.5 shrink-0" />
                Detail ujian gagal dimuat — periksa koneksimu sebelum melanjutkan.
              </p>
            )}
          </Panel>

          <Panel title="Tata Tertib Ujian" icon={<IconShield size={15} />}>
            <ul className="space-y-1.5">
              {ruleItems(rules).map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
                  <span
                    aria-hidden
                    className="mono mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold"
                    style={
                      r.forbidden
                        ? { background: 'var(--c-danger-soft)', color: 'var(--c-danger)' }
                        : { background: 'var(--c-primary-soft)', color: 'var(--c-primary)' }
                    }
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">{r.text}</span>
                </li>
              ))}
            </ul>

            <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border bg-canvas p-2.5 text-[13px] leading-relaxed">
              <input type="checkbox" className="mt-0.5" checked={agree} onChange={e => setAgree(e.target.checked)} />
              <span>
                Saya telah membaca dan menyetujui seluruh tata tertib ujian, serta mengerjakan ujian secara mandiri.
              </span>
            </label>

            {cameraOn && (
              <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border bg-canvas p-2.5 text-[13px] leading-relaxed">
                <input type="checkbox" className="mt-0.5" checked={camOk} onChange={e => setCamOk(e.target.checked)} />
                <span>
                  Saya mengizinkan kamera dipakai untuk pengawasan selama ujian{!cameraRequired && ' (opsional)'}. Foto
                  diambil berkala beresolusi rendah dan dihapus otomatis.
                </span>
              </label>
            )}

            {err && (
              <p role="alert" className="mt-2 flex items-start gap-1.5 rounded border border-danger-line bg-danger-soft p-2 text-[13px] text-danger">
                <IconAlertCircle size={15} className="mt-0.5 shrink-0" />
                {err}
              </p>
            )}

            {busy && (
              <div className="mt-3" aria-busy="true">
                <div className="progress">
                  <span style={{ width: `${STAGE_PCT[stage]}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted" role="status">{STAGE_LABEL[stage]}</p>
              </div>
            )}

            <div className="mt-3 space-y-2">
              <button
                type="button"
                className="btn btn-primary btn-block btn-lg"
                disabled={busy || !agree || !tokenOk || (cameraRequired && cameraOn && !camOk)}
                onClick={submit}
              >
                <IconCheck size={18} />
                {busy ? 'Menyiapkan…' : 'Mulai Ujian'}
              </button>
              <Link to="/s/exams" className="btn-ghost btn-block">Batal, kembali ke daftar</Link>
            </div>
          </Panel>
        </div>
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
        <IconStudents size={13} /> Butuh bantuan? Hubungi pengawas atau guru mata pelajaran.
      </p>
    </SiswaLayout>
  )
}

/** Susun butir tata tertib dari konfigurasi anti-cheat + aturan umum. */
function ruleItems(rules: RulesCfg): { text: string; forbidden: boolean }[] {
  const items: { text: string; forbidden: boolean }[] = [
    { text: 'Kerjakan sendiri. Bertanya atau bekerja sama dengan peserta lain tidak diperbolehkan.', forbidden: true },
  ]
  if (rules.anti_cheat_enabled !== false) {
    const tol = Number(rules.tolerance_seconds ?? 3)
    const penalty = Number(rules.penalty_points ?? 5)
    const maxPenalty = Number(rules.max_penalty ?? 30)
    const threshold = Number(rules.flag_threshold ?? 3)
    items.push({
      text: `Jangan meninggalkan halaman ujian lebih dari ${tol} detik. Pelanggaran dicatat dan dapat mengurangi nilai (${penalty} poin per pelanggaran, maksimal ${maxPenalty} poin).`,
      forbidden: true,
    })
    items.push({
      text: `Setelah ${threshold} pelanggaran, ujian dilaporkan kepada pengawas${rules.auto_submit ? ' dan dapat diakhiri otomatis' : ''}.`,
      forbidden: true,
    })
  }
  if (rules.camera_enabled) {
    items.push({
      text: 'Kamera mengambil foto berkala sebagai bukti kehadiran. Tidak ada rekaman video atau audio.',
      forbidden: false,
    })
  }
  items.push({ text: 'Jawaban tersimpan otomatis di perangkat. Jangan menutup peramban atau menghapus data situs.', forbidden: false })
  items.push({ text: 'Waktu mengikuti server. Ujian berakhir otomatis saat waktu habis.', forbidden: false })
  items.push({ text: 'Hubungi pengawas bila perangkat bermasalah — jangan memulai ulang sendiri.', forbidden: false })
  return items
}
