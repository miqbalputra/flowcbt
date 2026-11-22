// Formulir masuk "Jalur Kartu Ujian" (peserta tamu) — PRD FR-1.3 metode 2.
// Ekstraksi dari halaman Guest agar bisa dipakai sebagai tab di /s/login
// maupun halaman mandiri. Isi KODE UJIAN + TOKEN + NOMOR PESERTA dari kartu;
// kartu valid → identitas (nama, kelas, NIS, jenis kelamin) terisi OTOMATIS.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cardLookup, guestLogin, type CardLookup } from '../lib/student-api'
import { errMessage, rememberExamToken, saveLocalProfile } from '../lib/util'
import { TextField } from './SiswaLayout'
import { IconAlertCircle, IconCheck, IconClass, IconCredit, IconExam, IconKey, IconStudents } from '@/components/icons'

export function GuestForm() {
  const nav = useNavigate()
  const [examCode, setExamCode] = useState('')
  const [token, setToken] = useState('')
  const [card, setCard] = useState('')
  const [name, setName] = useState('')
  const [cls, setCls] = useState('')
  const [gender, setGender] = useState('')
  const [cardInfo, setCardInfo] = useState<CardLookup | null>(null)
  const [cardErr, setCardErr] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [looking, setLooking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lookup otomatis nomor kartu setelah kode ujian + token + nomor terisi.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    setCardInfo(null)
    setCardErr('')
    const c = card.trim()
    if (!c || !examCode.trim() || !token.trim()) return
    timer.current = setTimeout(async () => {
      setLooking(true)
      try {
        const d = await cardLookup(examCode.trim(), token.trim(), c)
        setCardInfo(d)
        setName(d.name || '')
        setCls(d.class_name || '')
        setGender(d.gender || '')
      } catch (er) {
        setCardInfo(null)
        setCardErr(errMessage(er))
      } finally {
        setLooking(false)
      }
    }, 450)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [card, examCode, token])

  const matched = Boolean(cardInfo?.matched)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await guestLogin({
        exam_code: examCode.trim(),
        token: token.trim(),
        card_number: card.trim() || undefined,
        name: name.trim() || undefined,
        gender: gender || undefined,
        class_name: cls.trim() || undefined,
      })
      saveLocalProfile({ name: r.student?.name || name.trim(), isGuest: true })
      rememberExamToken(token)
      nav('/s/exams', { replace: true })
    } catch (er) {
      setErr(errMessage(er))
      setBusy(false)
    }
  }

  return (
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
        id="cd"
        label="Nomor peserta (dari kartu ujian)"
        icon={<IconCredit size={17} />}
        mono
        value={card}
        onChange={e => setCard(e.target.value.toUpperCase())}
        placeholder="TA-26-03-10-0028-0001-2"
        autoComplete="off"
        hint={looking ? 'Memeriksa kartu…' : undefined}
      />
      {cardInfo?.matched && (
        <p className="flex items-start gap-1.5 rounded border border-success-line bg-success-soft p-2 text-[13px] text-success">
          <IconCheck size={15} className="mt-0.5 shrink-0" />
          <span>
            Kartu valid — identitas otomatis: <b>{cardInfo.name}</b>
            {cardInfo.class_name ? ` · kelas ${cardInfo.class_name}` : ''}
            {cardInfo.nis ? ` · NIS ${cardInfo.nis}` : ''}
          </span>
        </p>
      )}
      {cardErr && !cardInfo?.matched && card.trim() && (
        <p role="alert" className="flex items-start gap-1.5 rounded border border-danger-line bg-danger-soft p-2 text-[13px] text-danger">
          <IconAlertCircle size={15} className="mt-0.5 shrink-0" />
          {cardErr}
        </p>
      )}
      <TextField
        id="nm"
        label={matched ? 'Nama lengkap (dari kartu)' : 'Nama lengkap'}
        icon={<IconStudents size={17} />}
        value={name}
        onChange={e => setName(e.target.value)}
        autoComplete="name"
        placeholder="Sesuai daftar hadir"
        readOnly={matched}
        required
      />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <TextField
          id="cl"
          label={matched ? 'Kelas (dari kartu)' : 'Kelas (opsional)'}
          icon={<IconClass size={17} />}
          value={cls}
          onChange={e => setCls(e.target.value)}
          placeholder="mis. X IPA 1"
          readOnly={matched}
        />
        <div>
          <label className="auth-label" htmlFor="gd">Jenis kelamin</label>
          <select
            id="gd"
            className="auth-input"
            value={gender}
            onChange={e => setGender(e.target.value)}
            required
            disabled={matched}
          >
            <option value="">Pilih…</option>
            <option value="L">Laki-laki</option>
            <option value="P">Perempuan</option>
          </select>
        </div>
      </div>
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
        Nomor peserta, kode ujian, dan token tertera pada kartu ujian. Data tamu dapat digabungkan ke akun siswa oleh guru setelah ujian.
      </p>
    </form>
  )
}
