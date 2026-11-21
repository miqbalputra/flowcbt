// Login siswa dengan AKUN (FR-1.3 metode 1): username/NIS + password.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { studentLogin } from '../lib/student-api'
import { errMessage, saveLocalProfile } from '../lib/util'
import { AuthPortal } from '../components/AuthPortal'
import { TextField } from '../components/SiswaLayout'
import { IconKey, IconStudents, IconAlertCircle } from '@/components/icons'

export default function Login() {
  const nav = useNavigate()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
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
    <AuthPortal
      title="Masuk sebagai peserta"
      subtitle="Gunakan akun yang diberikan sekolah."
      guestLink={
        <>
          Ikut ujian tanpa akun?{' '}
          <Link className="font-semibold text-primary underline decoration-primary/40 underline-offset-2" to="/s/guest">
            Masuk sebagai tamu
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <TextField
          id="id"
          label="Username / NIS / kode siswa"
          icon={<IconStudents size={17} />}
          value={id}
          onChange={e => setId(e.target.value)}
          autoComplete="username"
          placeholder="mis. siswa2001"
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
    </AuthPortal>
  )
}
