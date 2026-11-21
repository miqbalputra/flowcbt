// Login tanpa akun (peserta tamu) — PRD FR-1.3 metode 2.
// Panel brand mini + input ber-ikon; kode ujian & token font-mono. Tanpa emoji.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { guestLogin } from '../lib/student-api'
import { errMessage, saveLocalProfile } from '../lib/util'
import { TextField } from '../components/SiswaLayout'
import { LogoMark, IconExam, IconKey, IconStudents, IconClass } from '@/components/icons'

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
      const r = await guestLogin({
        exam_code: examCode.trim(),
        token: token.trim(),
        name: name.trim(),
        class_name: cls.trim() || undefined,
      })
      saveLocalProfile({ name: name.trim() || r.student?.name, isGuest: true })
      nav('/s/exams', { replace: true })
    } catch (er) {
      setErr(errMessage(er))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4 text-text">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        {/* panel brand mini */}
        <div className="flex flex-col items-center gap-1.5 text-center">
          <LogoMark size={36} />
          <div className="text-xl font-bold tracking-tight">FlowCBT</div>
          <p className="text-sm text-muted">Ikuti ujian tanpa akun</p>
        </div>

        <TextField
          id="ec"
          label="Kode ujian"
          icon={<IconExam size={18} />}
          mono
          value={examCode}
          onChange={e => setExamCode(e.target.value)}
          autoComplete="off"
          required
        />
        <TextField
          id="tk"
          label="Token ujian"
          icon={<IconKey size={18} />}
          mono
          value={token}
          onChange={e => setToken(e.target.value)}
          autoComplete="off"
          required
        />
        <TextField
          id="nm"
          label="Nama lengkap"
          icon={<IconStudents size={18} />}
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="name"
          required
        />
        <TextField
          id="cl"
          label="Kelas (opsional)"
          icon={<IconClass size={18} />}
          value={cls}
          onChange={e => setCls(e.target.value)}
        />
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <button type="submit" className="btn-primary w-full" style={{ minHeight: 52 }} disabled={busy}>
          {busy ? 'Memproses…' : 'Lanjut'}
        </button>
        <p className="text-center text-xs text-muted">
          Punya akun? <Link className="text-primary underline" to="/s/login">Masuk akun</Link>
        </p>
      </form>
    </div>
  )
}
