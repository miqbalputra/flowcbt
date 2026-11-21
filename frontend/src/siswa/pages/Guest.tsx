// Login tanpa akun (peserta tamu) — PRD FR-1.3 metode 2.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { guestLogin } from '../lib/student-api'
import { errMessage, saveLocalProfile } from '../lib/util'
import { AuthPortal } from '../components/AuthPortal'
import { TextField } from '../components/SiswaLayout'
import { IconAlertCircle, IconClass, IconExam, IconKey, IconStudents } from '@/components/icons'

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
    <AuthPortal
      title="Masuk sebagai peserta tamu"
      subtitle="Isi data diri, lalu kode ujian dan token dari pengawas."
      footer={
        <>
          Punya akun sekolah?{' '}
          <Link className="font-semibold text-primary underline decoration-primary/40 underline-offset-2" to="/s/login">
            Masuk dengan akun
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <TextField
            id="ec"
            label="Kode ujian"
            icon={<IconExam size={17} />}
            mono
            value={examCode}
            onChange={e => setExamCode(e.target.value.toUpperCase())}
            placeholder="DEMO01"
            autoComplete="off"
            required
          />
          <TextField
            id="tk"
            label="Token"
            icon={<IconKey size={17} />}
            mono
            value={token}
            onChange={e => setToken(e.target.value.toUpperCase())}
            placeholder="••••••"
            autoComplete="off"
            required
          />
        </div>
        <TextField
          id="nm"
          label="Nama lengkap"
          icon={<IconStudents size={17} />}
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="name"
          placeholder="Sesuai daftar hadir"
          required
        />
        <TextField
          id="cl"
          label="Kelas (opsional)"
          icon={<IconClass size={17} />}
          value={cls}
          onChange={e => setCls(e.target.value)}
          placeholder="mis. X IPA 1"
        />
        {err && (
          <p role="alert" className="flex items-start gap-1.5 rounded border border-danger-line bg-danger-soft p-2 text-[13px] text-danger">
            <IconAlertCircle size={15} className="mt-0.5 shrink-0" />
            {err}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Memproses…' : 'Lanjut ke konfirmasi'}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-muted">
          Data tamu dapat digabungkan ke akun siswa oleh guru setelah ujian.
        </p>
      </form>
    </AuthPortal>
  )
}
