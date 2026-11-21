// Halaman login siswa dengan AKUN (PRD FR-1.3 metode 1): username/NIS + password.
// Panel brand mini (LogoMark + tagline) + input ber-ikon — tanpa emoji.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { studentLogin } from '../lib/student-api'
import { errMessage, saveLocalProfile } from '../lib/util'
import { TextField } from '../components/SiswaLayout'
import { LogoMark, IconStudents, IconKey } from '@/components/icons'
import { ThemeToggle } from '@/components/ThemeToggle'

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
    <div className="flex min-h-full items-center justify-center bg-bg p-4 text-text">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        {/* panel brand mini */}
        <div className="flex flex-col items-center gap-1.5 text-center">
          <LogoMark size={36} />
          <div className="text-xl font-bold tracking-tight">FlowCBT</div>
          <p className="text-sm text-muted">Masuk untuk mengikuti ujian</p>
        </div>
        <form onSubmit={submit} className="card w-full space-y-4">
          <TextField
            id="id"
            label="Username / NIS / kode siswa"
            icon={<IconStudents size={18} />}
            value={id}
            onChange={e => setId(e.target.value)}
            autoComplete="username"
            required
          />
          <TextField
            id="pw"
            type="password"
            label="Password"
            icon={<IconKey size={18} />}
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoComplete="current-password"
            required
          />
          {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          <button type="submit" className="btn-primary w-full" style={{ minHeight: 52 }} disabled={busy}>
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
          <p className="text-center text-xs text-muted">
            Ikut ujian tanpa akun? <Link className="text-primary underline" to="/s/guest">Masuk tamu</Link>
          </p>
        </form>
      </div>
      <div className="fixed right-4 top-4"><ThemeToggle /></div>
    </div>
  )
}
