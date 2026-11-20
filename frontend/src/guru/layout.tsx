// ProtectedRoute + kerangka app guru (PRD §11.1: sidebar desktop, bottom nav & drawer mobile)
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, clearTokens, getAccessToken, getRefreshToken } from '@/lib/api'
import { send } from './rpc'
import { useAuth } from '@/stores/auth'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Modal } from '@/components/modal'
import { asDict, unwrap } from './types'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/classes', label: 'Kelas', icon: '🏫' },
  { to: '/students', label: 'Siswa', icon: '🧑‍🎓' },
  { to: '/question-sets', label: 'Soal', icon: '📚' },
  { to: '/exams', label: 'Ujian', icon: '📝' },
  { to: '/reports', label: 'Laporan', icon: '📊' },
  { to: '/billing', label: 'Langganan', icon: '💳' },
  { to: '/settings', label: 'Pengaturan', icon: '⚙️' },
]

/** 4 rute utama di bottom nav mobile; sisanya masuk sheet "Lainnya" (FR-11.2) */
const MOBILE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/students', label: 'Siswa', icon: '🧑‍🎓' },
  { to: '/exams', label: 'Ujian', icon: '📝' },
  { to: '/reports', label: 'Laporan', icon: '📊' },
]
const MORE_KEYS = ['/classes', '/question-sets', '/billing', '/settings']

function titleFor(pathname: string): string {
  const rules: [RegExp, string][] = [
    [/^\/dashboard/, 'Dashboard'],
    [/^\/classes/, 'Kelas'],
    [/^\/students\/[^/]+/, 'Profil Siswa'],
    [/^\/students/, 'Siswa'],
    [/^\/question-sets\/[^/]+\/edit/, 'Editor Paket Soal'],
    [/^\/question-sets/, 'Paket Soal'],
    [/^\/exams\/new/, 'Buat Ujian'],
    [/^\/exams\/[^/]+\/cheating/, 'Laporan Kecurangan'],
    [/^\/exams\/[^/]+/, 'Detail Ujian'],
    [/^\/exams/, 'Ujian'],
    [/^\/reports\/live\/[^/]+/, 'Pantauan Live'],
    [/^\/reports\/live/, 'Laporan Live'],
    [/^\/reports\/history/, 'Riwayat Ujian'],
    [/^\/reports\/exams\/[^/]+/, 'Laporan Ujian'],
    [/^\/reports/, 'Laporan'],
    [/^\/billing/, 'Langganan'],
    [/^\/settings/, 'Pengaturan'],
  ]
  for (const [re, t] of rules) if (re.test(pathname)) return t
  return 'FlowCBT'
}

/** Sesi masih dihidupkan dari token tersimpan (/auth/me) */
function SessionBoot() {
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="card w-full max-w-sm space-y-3 text-center">
        <div className="text-lg font-bold tracking-tight">FlowCBT</div>
        <div className="skeleton h-4 w-2/3 mx-auto" />
        <div className="skeleton h-10 w-full" />
      </div>
    </div>
  )
}

function doLogout() {
  const rt = getRefreshToken()
  if (rt) send('/auth/logout', { refresh_token: rt }, 'POST').catch(() => {})
  clearTokens()
}

/**
 * ProtectedRoute semua halaman guru/admin: sesi harus kind "staff".
 * Reload → sesi dihidupkan dari /auth/me; gagal → /login.
 */
export default function ProtectedLayout() {
  const loc = useLocation()
  const navigate = useNavigate()
  const { session, setSession, logout } = useAuth()

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => unwrap(await api('/auth/me')),
    enabled: session?.kind !== 'staff' && !!getAccessToken(),
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!me.data) return
    const u = asDict(me.data.user ?? me.data)
    const role = String(u.role ?? '')
    setSession({
      kind: 'staff',
      userId: String(u.id ?? u.user_id ?? ''),
      role: (['owner', 'teacher', 'superadmin'].includes(role) ? role : 'owner') as 'owner' | 'teacher' | 'superadmin',
      tenantId: String(u.tenant_id ?? ''),
      name: String(u.full_name || u.name || 'Guru'),
    })
  }, [me.data, setSession])

  const staff = session?.kind === 'staff' ? session : null
  if (staff) return <Shell name={staff.name} role={staff.role} onLogout={() => { doLogout(); logout(); navigate('/login') }} />
  if (!getAccessToken()) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (me.fetchStatus === 'fetching') return <SessionBoot />
  return <Navigate to="/login" replace state={{ from: loc.pathname }} />
}

function Shell({ name, onLogout }: { name: string; role?: string; onLogout: () => void }) {
  const loc = useLocation()
  const title = titleFor(loc.pathname)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreItems = NAV.filter(item => MORE_KEYS.includes(item.to))
  const moreActive = MORE_KEYS.some(p => loc.pathname.startsWith(p))
  return (
    <div className="min-h-full lg:flex">
      {/* sidebar desktop (≥1025) — 232px, bg-surface, item aktif bg-primary-soft + border-l-2 primary */}
      <aside className="hidden lg:flex flex-col w-[232px] shrink-0 border-r border-border bg-surface sticky top-0 h-screen">
        <div className="px-4 py-4 text-base font-bold tracking-tight border-b border-border">FlowCBT</div>
        <nav className="flex flex-col py-2 flex-1 overflow-y-auto" aria-label="Navigasi utama">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/reports'}
              className={({ isActive }) =>
                `flex items-center gap-3 border-l-2 px-4 min-h-[44px] text-sm ${isActive ? 'bg-primary-soft text-primary border-primary font-semibold' : 'border-transparent text-muted hover:bg-bg hover:text-text'}`
              }
            >
              <span aria-hidden className="w-5 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-border space-y-1">
          <div className="text-sm font-medium truncate">{name}</div>
          <button type="button" onClick={onLogout} className="btn-ghost w-full text-sm">Keluar</button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 pb-20 lg:pb-8">
        {/* topbar — 56px, border-b */}
        <header className="sticky top-0 z-30 h-14 flex items-center gap-2 px-3 sm:px-4 bg-surface/95 backdrop-blur border-b border-border">
          <h1 className="font-semibold truncate flex-1">{title}</h1>
          <span className="hidden sm:block text-sm text-muted max-w-36 truncate">{name}</span>
          <ThemeToggle />
          <button
            type="button"
            onClick={onLogout}
            aria-label="Keluar"
            title="Keluar"
            className="btn-ghost touch-target w-11 h-11 !p-0 shrink-0"
          >
            ⏻
          </button>
        </header>
        <main className="p-3 sm:p-4 lg:p-6 max-w-6xl mx-auto">
          <Outlet />
        </main>
      </div>

      {/* bottom nav mobile (≤640): 5 slot — 4 rute utama + "Lainnya" (bottom sheet) */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border flex safe-bottom"
        aria-label="Menu utama"
      >
        {MOBILE_NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex-1 min-w-0 min-h-14 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 border-t-2 text-[11px] leading-tight text-center ${isActive ? 'text-primary border-primary font-semibold' : 'text-muted border-transparent'}`
            }
          >
            <span aria-hidden className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`flex-1 min-w-0 min-h-14 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 border-t-2 text-[11px] leading-tight text-center ${moreActive ? 'text-primary border-primary font-semibold' : 'text-muted border-transparent'}`}
        >
          <span aria-hidden className="text-lg leading-none">⋯</span>
          Lainnya
        </button>
      </nav>

      {/* bottom sheet "Lainnya" — rute sekunder + tema (akses desktop tetap via sidebar) */}
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu lainnya">
        <div className="grid grid-cols-2 gap-2">
          {moreItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg border border-border px-3 min-h-[44px] text-sm ${isActive ? 'bg-primary-soft text-primary border-primary/40 font-semibold' : 'hover:bg-bg'}`
              }
            >
              <span aria-hidden>{item.icon}</span>
              <span className="truncate">{item.to === '/question-sets' ? 'Soal / Paket' : item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 min-h-[44px] text-sm">
          <span>Tema tampilan</span>
          <ThemeToggle />
        </div>
      </Modal>
    </div>
  )
}
