// Login tanpa akun (peserta tamu) — PRD FR-1.3 metode 2.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { guestLogin } from '../lib/student-api'
import { errMessage } from '../lib/util'

export default function Guest() {
  const nav = useNavigate()
  const [examCode, setExamCode] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [cls, setCls] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await guestLogin({
        exam_code: examCode.trim(),
        token: token.trim(),
        name: name.trim(),
        class_name: cls.trim() || undefined,
      })
      nav('/s/exams', { replace: true })
    } catch (er) {
      setErr(errMessage(er))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <h1 className="text-lg font-bold">Ujian Tanpa Akun</h1>
        <p className="text-xs text-muted">Isi kode ujian + token dari pengawasmu, lalu data dirimu.</p>
        <div>
          <label className="label" htmlFor="ec">Kode ujian</label>
          <input id="ec" className="input" value={examCode} onChange={e => setExamCode(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="tk">Token ujian</label>
          <input id="tk" className="input" value={token} onChange={e => setToken(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="nm">Nama lengkap</label>
          <input id="nm" className="input" value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="cl">Kelas (opsional)</label>
          <input id="cl" className="input" value={cls} onChange={e => setCls(e.target.value)} />
        </div>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Memproses…' : 'Lanjut'}
        </button>
        <p className="text-center text-xs text-muted">
          Punya akun? <Link className="text-primary underline" to="/s/login">Masuk akun</Link>
        </p>
      </form>
    </div>
  )
}
