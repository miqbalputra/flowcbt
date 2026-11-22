// Registrasi sekolah/admin — 7 field dengan jenjang select (FR-1.1)
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { errMessage, unwrap } from '../types'
import { AuthShell } from './shell'

const LEVELS = ['PAUD/TK', 'SD/MI', 'SMP/MTs', 'SMA/SMK/MA', 'Perguruan Tinggi', 'Kursus/Bimbel', 'Lainnya']

export default function Register() {
  const nav = useNavigate()
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', password: '', confirm: '', school_name: '', school_level: LEVELS[1],
  })
  const [verifyToken, setVerifyToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (form.password.length < 8) { toast('Password minimal 8 karakter', 'error'); return }
    if (form.password !== form.confirm) { toast('Konfirmasi password tidak sama', 'error'); return }
    setBusy(true)
    try {
      const res = unwrap(await send('/auth/register', ({
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          password: form.password,
          school_name: form.school_name,
          school_level: form.school_level,
        }), 'POST'))
      // mode dev: token verifikasi dikirim langsung di respons (email worker belum ada)
      const devToken = String(res.verify_token ?? res.token ?? '')
      if (devToken) {
        setVerifyToken(devToken)
        toast('Registrasi berhasil — verifikasi email Anda (token dev tersedia)', 'success')
      } else {
        toast('Registrasi berhasil — cek email Anda untuk verifikasi.', 'success')
        nav('/login')
      }
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    try {
      await send('/auth/verify-email', { token: tokenInput.trim() }, 'POST')
      toast('Email terverifikasi! Silakan masuk.', 'success')
      nav('/login')
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (verifyToken) {
    return (
      <AuthShell title="Verifikasi Email">
        <p className="text-sm text-muted">Masukkan kode verifikasi yang dikirim ke {form.email}.</p>
        {verifyToken && (
          <div className="text-xs rounded-lg p-3 bg-warn-soft text-warn break-all">
            Mode dev — token verifikasi: <code>{verifyToken}</code>
          </div>
        )}
        <form onSubmit={ev => { ev.preventDefault(); verify() }} className="space-y-3">
          <div>
            <label className="auth-label" htmlFor="vt">Token verifikasi</label>
            <input id="vt" className="auth-input" required value={tokenInput}
              onChange={e => setTokenInput(e.target.value)} placeholder="Kode dari email" />
          </div>
          <button type="submit" className="btn-primary flex h-10 w-full items-center justify-center rounded-lg" disabled={busy}>
            {busy ? 'Memverifikasi…' : 'Verifikasi Email'}
          </button>
        </form>
        <Link to="/login" className="block text-center text-sm text-primary hover:underline">Kembali ke masuk</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Buat akun sekolah Anda" subtitle="Anda akan menjadi Admin Sekolah untuk lembaga Anda.">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="auth-label" htmlFor="fn">Nama lengkap</label>
          <input id="fn" className="auth-input" required value={form.full_name} onChange={set('full_name')} placeholder="Budi Santoso" />
        </div>
        <div>
          <label className="auth-label" htmlFor="em">Email</label>
          <input id="em" className="auth-input" type="email" required value={form.email} onChange={set('email')} placeholder="guru@sekolah.sch.id" />
        </div>
        <div>
          <label className="auth-label" htmlFor="ph">Nomor HP <span className="font-normal">(opsional)</span></label>
          <input id="ph" className="auth-input" type="tel" value={form.phone} onChange={set('phone')} placeholder="0812…" />
        </div>
        <div>
          <label className="auth-label" htmlFor="sn">Nama sekolah/lembaga</label>
          <input id="sn" className="auth-input" required value={form.school_name} onChange={set('school_name')} placeholder="SMK Negeri 1" />
        </div>
        <div>
          <label className="auth-label" htmlFor="lv">Jenjang</label>
          <select id="lv" className="auth-input" value={form.school_level} onChange={set('school_level')}>
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="auth-label" htmlFor="pw">Password</label>
            <input id="pw" className="auth-input" type="password" required autoComplete="new-password"
              value={form.password} onChange={set('password')} placeholder="min. 8 karakter" />
          </div>
          <div>
            <label className="auth-label" htmlFor="pwc">Ulangi password</label>
            <input id="pwc" className="auth-input" type="password" required autoComplete="new-password"
              value={form.confirm} onChange={set('confirm')} placeholder="ulangi" />
          </div>
        </div>
        <button type="submit" className="btn-primary flex h-10 w-full items-center justify-center rounded-lg" disabled={busy}>
          {busy ? 'Mendaftarkan…' : 'Daftar'}
        </button>
      </form>
      <p className="text-center text-sm pt-1">
        Sudah punya akun? <Link className="text-primary hover:underline" to="/login">Masuk</Link>
      </p>
    </AuthShell>
  )
}
