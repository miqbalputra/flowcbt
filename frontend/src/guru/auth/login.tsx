// Halaman login guru/admin (FR-1.2) — estetika "ruang kerja" konsisten dengan
// Design System v3: panel brand bertekstur halus, formulir dengan ikon,
// toggle lihat password, deteksi Caps Lock, alert error, dan akun demo.
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom'
import { setTokens, clearTokens, getAccessToken } from '@/lib/api'
import { send } from '../rpc'
import { useAuth } from '@/stores/auth'
import { toast } from '@/components/toast'
import { asDict, errMessage, unwrap } from '../types'
import { AuthShell } from './shell'
import { IconEye, IconEyeOff, IconWarn } from '@/components/icons'

const IconMail = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
)
const IconLock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

function roleOf(u: { role?: string }): 'owner' | 'teacher' | 'superadmin' {
  return (['owner', 'teacher', 'superadmin'] as const).includes(u?.role as never) ? (u.role as 'owner' | 'teacher' | 'superadmin') : 'owner'
}

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const { session, setSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [capsOn, setCapsOn] = useState(false)
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
      toast('Selamat datang kembali', 'success')
      nav((loc.state as { from?: string } | null)?.from || '/dashboard', { replace: true })
    } catch (err) {
      setError(errMessage(err))
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onPwKey = (e: KeyboardEvent<HTMLInputElement>) =>
    setCapsOn(Boolean(e.getModifierState?.('CapsLock')))

  return (
    <AuthShell title="Masuk ke akun guru" subtitle="Kelola ujian, nilai, dan laporan sekolah Anda dalam satu tempat.">
      <form onSubmit={submit} className="space-y-4" noValidate={false}>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
              <IconMail />
            </span>
            <input
              id="email" className="input pl-9" type="email" required autoComplete="email"
              placeholder="guru@sekolah.sch.id" value={email} onChange={e => setEmail(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">Password</label>
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary"
              aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}
            >
              {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              {showPw ? 'Sembunyikan' : 'Lihat'}
            </button>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
              <IconLock />
            </span>
            <input
              id="password" className="input px-9" type={showPw ? 'text' : 'password'} required
              autoComplete="current-password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} onKeyUp={onPwKey}
              aria-invalid={Boolean(error)}
            />
          </div>
          {capsOn && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warn" role="status">
              <IconWarn size={13} /> Caps Lock aktif
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">
            <span className="mt-0.5 shrink-0" aria-hidden><IconWarn size={15} /></span>
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="btn-primary flex w-full items-center justify-center gap-2" disabled={busy}>
          <span className="flex h-4 w-4 items-center justify-center">{busy && <span className="spinner" />}</span>
          {busy ? 'Memproses…' : 'Masuk'}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm">
        <Link className="font-medium text-muted hover:text-primary hover:underline" to="/forgot-password">Lupa password?</Link>
        <Link className="font-medium text-primary hover:underline" to="/register">Daftar sekolah →</Link>
      </div>

      {/* akun demo untuk lingkung ujicoba publik — hapus blok ini saat produksi */}
      <button
        type="button"
        className="mt-4 w-full rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted transition-colors hover:border-primary-line hover:bg-primary-soft hover:text-primary"
        onClick={() => { setEmail('guru@demo.cbt'); setPassword('Guru#12345') }}
      >
        Isi akun demo guru (laporan ujicoba publik)
      </button>

      {getAccessToken() && (
        <button
          type="button"
          className="btn-ghost mt-3 w-full text-xs"
          onClick={() => { clearTokens(); toast('Sesi lama dibersihkan', 'info') }}
        >
          Bersihkan sesi tersimpan
        </button>
      )}
    </AuthShell>
  )
}
