// Login peserta dengan dua JALUR berdampingan (tab) — PRD FR-1.3:
// Jalur 1: AKUN SEKOLAH (username / NIS / kode siswa + kata sandi).
// Jalur 2: KARTU UJIAN (kode ujian + token + nomor peserta — identitas otomatis).
// /s/guest kini redirect ke sini (tab kartu) — kartu ujian lama tetap nyambung.
import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { studentLogin } from '../lib/student-api'
import { errMessage, saveLocalProfile } from '../lib/util'
import { AuthPortal } from '../components/AuthPortal'
import { GuestForm } from '../components/GuestForm'
import { TextField } from '../components/SiswaLayout'
import { IconCredit, IconKey, IconStudents, IconAlertCircle } from '@/components/icons'

type Jalur = 'akun' | 'kartu'

export default function Login() {
  const [params, setParams] = useSearchParams()
  const start: Jalur = params.get('jalur') === 'kartu' ? 'kartu' : 'akun'
  const [jalur, setJalur] = useState<Jalur>(start)
  const pick = (j: Jalur) => {
    setJalur(j)
    setParams(j === 'kartu' ? { jalur: 'kartu' } : {}, { replace: true })
  }

  return (
    <AuthPortal
      title="Masuk ke ruang ujian"
      subtitle={
        jalur === 'akun'
          ? 'Gunakan akun sekolah Anda — username, NIS, atau kode siswa beserta kata sandi.'
          : 'Gunakan kartu ujian Anda — kode ujian, token, dan nomor peserta; identitas terisi otomatis.'
      }
    >
      {/* ---- dua opsi berdampingan ---- */}
      <div
        role="tablist"
        aria-label="Pilih cara masuk"
        className="mb-5 grid grid-cols-2 gap-1.5 rounded-lg border border-border bg-canvas p-1.5"
      >
        <button
          type="button"
          role="tab"
          id="tab-akun"
          aria-selected={jalur === 'akun'}
          aria-controls="panel-masuk"
          onClick={() => pick('akun')}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-[13px] font-semibold transition-colors ${
            jalur === 'akun'
              ? 'border-primary-line bg-surface text-text shadow-xs'
              : 'border-transparent text-muted hover:text-text'
          }`}
        >
          <IconStudents size={15} />
          Akun sekolah
        </button>
        <button
          type="button"
          role="tab"
          id="tab-kartu"
          aria-selected={jalur === 'kartu'}
          aria-controls="panel-masuk"
          onClick={() => pick('kartu')}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-[13px] font-semibold transition-colors ${
            jalur === 'kartu'
              ? 'border-primary-line bg-surface text-text shadow-xs'
              : 'border-transparent text-muted hover:text-text'
          }`}
        >
          <IconCredit size={15} />
          Kartu ujian
        </button>
      </div>

      <div id="panel-masuk" role="tabpanel" aria-labelledby={jalur === 'akun' ? 'tab-akun' : 'tab-kartu'}>
        {jalur === 'akun' ? <AkunForm /> : <GuestForm />}
      </div>
    </AuthPortal>
  )
}

function AkunForm() {
  const nav = useNavigate()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await studentLogin(id.trim(), pw)
      if (!r.access_token) {
        setErr('Server tidak mengembalikan sesi. Coba lagi.')
        setBusy(false)
        return
      }
      saveLocalProfile({ name: r.student?.name || id.trim(), sid: r.student?.nis || r.student?.username, isGuest: false })
      nav('/s/exams', { replace: true })
    } catch (er) {
      setErr(errMessage(er))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <TextField
        id="id"
        label="Username / NIS / Kode siswa"
        icon={<IconStudents size={17} />}
        value={id}
        onChange={e => setId(e.target.value)}
        autoComplete="username"
        placeholder="mis. siswa2001 / NIS: 2001"
        hint="Diberikan sekolah — bukan nomor peserta kartu ujian."
        required
      />
      <TextField
        id="pw"
        type="password"
        label="Kata sandi"
        icon={<IconKey size={17} />}
        value={pw}
        onChange={e => setPw(e.target.value)}
        autoComplete="current-password"
        placeholder="••••••••"
        required
      />
      {err && (
        <p role="alert" className="flex items-start gap-1.5 rounded border border-danger-line bg-danger-soft p-2 text-[13px] text-danger">
          <IconAlertCircle size={15} className="mt-0.5 shrink-0" />
          {err}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
        {busy ? 'Memproses…' : 'Masuk ke ruang ujian'}
      </button>
      <p className="text-center text-[11px] leading-relaxed text-muted">
        Lupa kata sandi? Hubungi guru atau pengawas untuk direset.
      </p>
    </form>
  )
}
