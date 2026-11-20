// Halaman login guru/admin (FR-1.2)
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, setTokens, clearTokens, getAccessToken } from '@/lib/api'
import { send } from '../rpc'
import { useAuth } from '@/stores/auth'
import { toast } from '@/components/toast'
import { asDict, errMessage, unwrap } from '../types'
import { AuthShell } from './shell'
import { Link } from 'react-router-dom'

function roleOf(u: { role?: string }): 'owner' | 'teacher' | 'superadmin' {
  return (['owner', 'teacher', 'superadmin'] as const).includes(u?.role as never) ? (u.role as 'owner' | 'teacher' | 'superadmin') : 'owner'
}

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const { session, setSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (session?.kind === 'staff') return <Navigate to="/dashboard" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = unwrap(await send('/auth/login', { email, password }, 'POST'))
      setTokens(String(res.access_token ?? ''), String(res.refresh_token ?? ''))
      const u = asDict(res.user ?? res)
      setSession({
        kind: 'staff',
        userId: String(u.id ?? u.user_id ?? ''),
        role: roleOf(u),
        tenantId: String(u.tenant_id ?? ''),
        name: String(u.full_name ?? u.name ?? email),
      })
      toast('Selamat datang kembali! 👋', 'success')
      nav((loc.state as { from?: string } | null)?.from || '/dashboard', { replace: true })
    } catch (err) {
      setError(errMessage(err))
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Masuk">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" required autoComplete="email"
            placeholder="guru@sekolah.sch.id" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" required autoComplete="current-password"
            placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Memproses…' : 'Masuk'}
        </button>
      </form>
      <div className="flex justify-between text-sm pt-1">
        <Link className="text-primary hover:underline" to="/forgot-password">Lupa password?</Link>
        <Link className="text-primary hover:underline" to="/register">Daftar sekolah</Link>
      </div>
      {getAccessToken() && (
        <button
          type="button"
          className="btn-ghost w-full text-xs"
          onClick={() => { clearTokens(); toast('Sesi lama dibersihkan', 'info') }}
        >
          Bersihkan sesi tersimpan
        </button>
      )}
    </AuthShell>
  )
}
