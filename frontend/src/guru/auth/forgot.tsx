// Lupa password (FR-1.2) — di dev, reset_token dikembalikan langsung
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { errMessage, unwrap } from '../types'
import { AuthShell } from './shell'

export default function Forgot() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = unwrap(await send('/auth/forgot-password', { email }, 'POST'))
      const devToken = String(res.reset_token ?? res.token ?? '')
      if (devToken) {
        setResetToken(devToken)
        toast('Tautan reset dibuat (mode dev)', 'success')
      } else {
        toast('Tautan reset sudah dikirim ke email Anda', 'success')
      }
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Lupa Password" subtitle="Masukkan email Anda — kami kirim tautan untuk mengatur ulang password.">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" required value={email}
            onChange={e => setEmail(e.target.value)} placeholder="guru@sekolah.sch.id" />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Mengirim…' : 'Kirim Tautan Reset'}
        </button>
      </form>
      {resetToken && (
        <div className="text-xs rounded-lg p-3 bg-warn-soft text-warn break-all">
          Mode dev — token reset:{' '}
          <Link to={`/reset-password?token=${encodeURIComponent(resetToken)}`} className="underline font-medium">
            lanjut atur password →
          </Link>
        </div>
      )}
      <Link to="/login" className="block text-center text-sm text-primary hover:underline">Kembali ke masuk</Link>
    </AuthShell>
  )
}
