// Kerangka aplikasi guru/admin — "Ruang Kerja" gaya portal institusi.
// Desktop: sidebar 240px (brand ink + grup navigasi + kartu pengguna),
// topbar tipis berisi jejak halaman. Mobile: bottom nav 5 slot + sheet.
import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, clearTokens, getAccessToken, getRefreshToken } from '@/lib/api'
import { send } from './rpc'
import { useAuth } from '@/stores/auth'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Modal } from '@/components/modal'
import {
  LogoMark, IconBank, IconChart2, IconClass, IconCredit, IconDashboard,
  IconDots, IconExam, IconLogout, IconSettings, IconShield, IconStudents,
  IconChevronDown,
} from '@/components/icons'
import { asDict, unwrap } from './types'

type NavIco = ComponentType<{ size?: number }>

type NavItem = { to: string; label: string; Ico: NavIco }

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Ringkasan',
    items: [{ to: '/dashboard', label: 'Dashboard', Ico: IconDashboard }],
  },
  {
    label: 'Akademik',
    items: [
      { to: '/classes', label: 'Kelas', Ico: IconClass },
      { to: '/students', label: 'Siswa', Ico: IconStudents },
      { to: '/question-sets', label: 'Bank Soal', Ico: IconBank },
      { to: '/exams', label: 'Ujian', Ico: IconExam },
    ],
  },
  {
    label: 'Analitik',
    items: [
      { to: '/reports', label: 'Laporan', Ico: IconChart2 },
      { to: '/cheating', label: 'Anti-Curang', Ico: IconShield },
    ],
  },
  {
    label: 'Akun',
    items: [
      { to: '/billing', label: 'Langganan', Ico: IconCredit },
      { to: '/settings', label: 'Pengaturan', Ico: IconSettings },
    ],
  },
]

const NAV = NAV_GROUPS.flatMap(g => g.items)

/** 4 rute utama di bottom nav mobile; sisanya masuk sheet "Lainnya" (FR-11.2) */
const MOBILE_NAV = [
  { to: '/dashboard', label: 'Dashboard', Ico: IconDashboard },
  { to: '/students', label: 'Siswa', Ico: IconStudents },
  { to: '/exams', label: 'Ujian', Ico: IconExam },
  { to: '/reports', label: 'Laporan', Ico: IconChart2 },
]
const MORE_KEYS = ['/classes', '/question-sets', '/cheating', '/billing', '/settings']

function titleFor(pathname: string): string {
  const rules: [RegExp, string][] = [
    [/^\/cheating/, 'Anti-Curang'],
    [/^\/dashboard/, 'Dashboard'],
    [/^\/classes/, 'Kelas'],
    [/^\/students\/[^/]+/, 'Profil Siswa'],
    [/^\/students/, 'Siswa'],
    [/^\/question-sets\/[^/]+\/edit/, 'Editor Paket Soal'],
    [/^\/question-sets/, 'Bank Soal'],
    [/^\/exams\/new/, 'Buat Ujian'],
    [/^\/exams\/[^/]+\/cheating/, 'Laporan Kecurangan'],
    [/^\/exams\/[^/]+\/cards/, 'Kartu Ujian'],
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
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-surface p-6 text-center shadow-xs">
        <div className="flex items-center justify-center gap-2">
          <LogoMark size={26} />
          <span className="text-lg font-bold tracking-tight">FlowCBT</span>
        </div>
        <div className="skeleton mx-auto h-3 w-2/3" />
        <div className="skeleton h-9 w-full" />
        <p className="text-xs text-muted">Memuat sesi…</p>
      </div>
    </div>
  )
}

function doLogout() {
  const rt = getRefreshToken()
  // refresh hidup di cookie httpOnly — logout cukup POST /auth/logout
  // (server mencabut & membersihkan cookie). Body opsional untuk mode lama.
  send('/auth/logout', rt ? { refresh_token: rt } : {}, 'POST').catch(() => {})
  clearTokens()
}

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
  // Sesi valid tapi state belum terisi (efek belum jalan) — tetap tampilkan boot,
  // jangan lempar ke /login (menyebabkan deep-link selalu balik ke /dashboard).
  if (me.data || me.fetchStatus === 'fetching') return <SessionBoot />
  return <Navigate to="/login" replace state={{ from: loc.pathname }} />
}

function Shell({ name, role, onLogout }: { name: string; role?: string; onLogout: () => void }) {
  const loc = useLocation()
  const title = titleFor(loc.pathname)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreItems = NAV.filter(item => MORE_KEYS.includes(item.to))
  const moreActive = MORE_KEYS.some(p => loc.pathname.startsWith(p))
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || 'G'
  const roleLabel = role === 'superadmin' ? 'Super Admin' : role === 'teacher' ? 'Guru' : 'Admin Sekolah'

  return (
    <div className="min-h-dvh bg-bg lg:flex">
      {/* ================= SIDEBAR DESKTOP ================= */}
      <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <LogoMark size={30} />
          <div className="min-w-0">
            <div className="text-[15px] font-bold leading-tight tracking-tight">FlowCBT</div>
            <div className="text-[11px] text-muted">Ruang Kerja Ujian</div>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3.5" aria-label="Navigasi utama">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-muted/80">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/reports'}
                    className={({ isActive }) =>
                      `flex min-h-10 items-center gap-2.5 rounded-md border px-2.5 text-sm transition-colors ${
                        isActive
                          ? 'border-primary-line bg-primary-soft font-semibold text-primary'
                          : 'border-transparent text-muted hover:bg-canvas hover:text-text'
                      }`
                    }
                  >
                    <span aria-hidden className="flex w-5 justify-center"><item.Ico size={17} /></span>
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-2.5">
          <div className="flex items-center gap-2.5 rounded-md px-1.5 py-2">
            <span aria-hidden className="mono flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink text-[11px] font-bold text-ink-fg">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold leading-tight">{name}</div>
              <div className="truncate text-[11px] text-muted">{roleLabel}</div>
            </div>
            <button type="button" onClick={onLogout} title="Keluar" aria-label="Keluar" className="btn-quiet h-9 w-9 !p-0">
              <IconLogout size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ================= AREA KONTEN ================= */}
      <div className="min-w-0 flex-1 pb-[68px] lg:pb-0">
        <header className="sticky top-0 z-30 border-b border-border bg-surface">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="hidden text-xs text-muted sm:inline">FlowCBT</span>
              <span aria-hidden className="hidden text-muted sm:inline">/</span>
              <h1 className="truncate text-sm font-semibold sm:text-[15px]">{title}</h1>
            </div>
            <span className="hidden max-w-40 truncate text-xs text-muted md:inline">{name}</span>
            <ThemeToggle />
            <button
              type="button"
              onClick={onLogout}
              aria-label="Keluar"
              title="Keluar"
              className="btn-quiet h-11 w-11 shrink-0 !p-0"
            >
              <IconLogout size={18} />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1240px] px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-6">
          <Outlet />
        </main>
      </div>

      {/* ================= BOTTOM NAV MOBILE ================= */}
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface lg:hidden"
        aria-label="Menu utama"
      >
        {MOBILE_NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 border-t-2 px-1 py-1.5 text-center text-[11px] leading-tight ${
                isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted'
              }`
            }
          >
            <span aria-hidden><item.Ico size={20} /></span>
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 border-t-2 px-1 py-1.5 text-center text-[11px] leading-tight ${
            moreActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted'
          }`}
        >
          <span aria-hidden><IconDots size={20} /></span>
          Lainnya
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu lainnya">
        <div className="grid grid-cols-2 gap-2">
          {moreItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-2.5 rounded-md border px-3 text-sm ${
                  isActive ? 'border-primary-line bg-primary-soft font-semibold text-primary' : 'border-border hover:bg-canvas'
                }`
              }
            >
              <span aria-hidden><item.Ico size={16} /></span>
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="flex min-h-11 items-center justify-between rounded-md border border-border px-3 text-sm">
          <span>Tema tampilan</span>
          <ThemeToggle />
        </div>
      </Modal>
    </div>
  )
}
