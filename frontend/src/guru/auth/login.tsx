// Halaman login guru/admin (FR-1.2) — mengikuti pola login "tebar.app":
// aksi cepat di atas → pembatas → formulir; input kompak, toggle password,
// deteksi Caps Lock, alert error, dan akun demo (hapus saat produksi).
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom'
import { setTokens, clearTokens, getAccessToken } from '@/lib/api'
import { send } from '../rpc'
import { useAuth } from '@/stores/auth'
import { toast } from '@/components/toast'
import { asDict, errMessage, unwrap } from '../types'
import { AuthShell } from './shell'
import { IconExam, IconEye, IconEyeOff, IconWarn } from '@/components/icons'

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
    <AuthShell title="Selamat datang kembali" subtitle="Masuk untuk mengelola ujian, nilai, dan laporan sekolah Anda.">
      <div className="grid gap-5">
        {/* aksi cepat — posisi "Continue with Google" pada referensi */}
        <button type="button" className="auth-alt" onClick={() => { setEmail('guru@demo.cbt'); setPassword('Guru#12345') }}>
          <IconExam />
          Coba cepat — akun demo guru
        </button>

        <div className="auth-divider" role="separator">atau masuk manual</div>

        <form onSubmit={submit} className="grid gap-4" noValidate={false}>
          <div>
            <label className="auth-label" htmlFor="email">Email</label>
            <input
              id="email" className="auth-input" type="email" required autoComplete="email"
              placeholder="guru@sekolah.sch.id" value={email} onChange={e => setEmail(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="auth-label" htmlFor="password">Password</label>
              <Link className="auth-label !mb-0 cursor-pointer font-medium text-muted hover:text-primary hover:underline underline-offset-4" to="/forgot-password">
                Lupa password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="password" className="auth-input pr-11" type={showPw ? 'text' : 'password'} required
                autoComplete="current-password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} onKeyUp={onPwKey}
                aria-invalid={Boolean(error)}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted outline-none transition-colors hover:text-primary focus-visible:text-primary"
                aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}
              >
                {showPw ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
            </div>
            {capsOn && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warn" role="status">
                <IconWarn size={13} /> Caps Lock aktif
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">
              <span className="mt-0.5 shrink-0" aria-hidden><IconWarn size={15} /></span>
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn-primary flex h-10 w-full items-center justify-center gap-2 rounded-lg" disabled={busy}>
            <span className="flex h-4 w-4 items-center justify-center">{busy && <span className="spinner" />}</span>
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          Belum punya akun?{' '}
          <Link className="lnk font-medium text-primary underline-offset-4 hover:underline" to="/register">Daftar sekolah</Link>
        </p>

        {getAccessToken() && (
          <button
            type="button"
            className="mx-auto text-xs text-muted underline-offset-4 hover:text-primary hover:underline"
            onClick={() => { clearTokens(); toast('Sesi lama dibersihkan', 'info') }}
          >
            Bersihkan sesi tersimpan
          </button>
        )}

        <p className="text-center text-[11px] leading-relaxed text-muted">
          Dengan melanjutkan, Anda menyetujui ketentuan layanan dan kebijakan
          privasi FlowCBT.
        </p>
      </div>
    </AuthShell>
  )
}
