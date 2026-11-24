// Atur ulang password via token (FR-1.2)
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { errMessage } from '../types'
import { AuthShell } from './shell'

export default function Reset() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [token, setToken] = useState(params.get('token') ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (newPassword.length < 8) { toast('Password minimal 8 karakter', 'error'); return }
    if (newPassword !== confirm) { toast('Konfirmasi password tidak sama', 'error'); return }
    setBusy(true)
    try {
      await send('/auth/reset-password', { token: token.trim(), new_password: newPassword }, 'POST')
      toast('Password berhasil diatur ulang — silakan masuk', 'success')
      nav('/login')
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Atur ulang password" subtitle="Buat password baru memakai token reset dari email.">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="auth-label" htmlFor="tk">Token reset</label>
          <input id="tk" className="auth-input" required value={token} onChange={e => setToken(e.target.value)} placeholder="Kode dari email" />
        </div>
        <div>
          <label className="auth-label" htmlFor="np">Password baru</label>
          <input id="np" className="auth-input" type="password" required autoComplete="new-password"
            value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="min. 8 karakter" />
        </div>
        <div>
          <label className="auth-label" htmlFor="npc">Ulangi password baru</label>
          <input id="npc" className="auth-input" type="password" required autoComplete="new-password"
            value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="ulangi" />
        </div>
        <button type="submit" className="btn-primary flex h-10 w-full items-center justify-center rounded-lg" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan Password Baru'}
        </button>
      </form>
      <Link to="/login" className="lnk mx-auto block w-fit text-center text-sm text-primary hover:underline">Kembali ke masuk</Link>
    </AuthShell>
  )
}
