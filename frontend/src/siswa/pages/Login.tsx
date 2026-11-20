// Halaman login siswa dengan AKUN (PRD FR-1.3 metode 1): username/NIS + password.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { studentLogin } from '../lib/student-api'
import { errMessage } from '../lib/util'
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
      nav('/s/exams', { replace: true })
    } catch (er) {
      setErr(errMessage(er))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <div className="text-3xl font-extrabold text-primary">FlowCBT</div>
          <p className="text-sm text-muted mt-1">Ujian online — tetap jalan walau internet putus.</p>
        </div>
        <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
          <div>
            <label className="label" htmlFor="id">Username / NIS / kode siswa</label>
            <input id="id" className="input" value={id} onChange={e => setId(e.target.value)} autoComplete="username" required />
          </div>
          <div>
            <label className="label" htmlFor="pw">Password</label>
            <input id="pw" type="password" className="input" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" required />
          </div>
          {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
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
