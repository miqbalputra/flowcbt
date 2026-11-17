import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApiQuery, logout as logoutAll } from '@flowcbt/api-client';
import { ThemeToggle, Icon, Logo, type IconName } from '@flowcbt/ui';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/students', label: 'Siswa', icon: 'students' },
  { to: '/classes', label: 'Kelas', icon: 'classes' },
  { to: '/question-sets', label: 'Bank Soal', icon: 'bank' },
  { to: '/exams', label: 'Ujian', icon: 'exams' },
  { to: '/reports/live', label: 'Pantau Live', icon: 'report' },
  { to: '/reports/history', label: 'Hasil & Rekap', icon: 'trophy' },
  { to: '/billing', label: 'Langganan', icon: 'billing' },
  { to: '/settings', label: 'Pengaturan', icon: 'settings' },
];
const ADMIN_NAV = { to: '/admin/tenants', label: 'Super Admin', icon: 'shield' as IconName };
const MOBILE_NAV: string[] = ['/dashboard', '/students', '/question-sets', '/exams', '/reports/live'];

// Layout guru/admin: sidebar di desktop, bottom nav di mobile (FR-11.2).
export default function Layout() {
  const nav = useNavigate();
  const { data: me } = useApiQuery<any>(['me'], '/auth/me');
  const logout = () => { void logoutAll().finally(() => nav('/login')); };
  const items = me?.role === 'super_admin' ? [...NAV, ADMIN_NAV] : NAV;
  const initials = (me?.name || '?')
    .split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* A-10: skip-link muncul saat menerima fokus keyboard */}
      <a href="#main" className="skip-link">Lewati ke konten</a>
      {/* Sidebar desktop */}
      <aside className="t-sidebar">
        <div style={{ padding: '18px 16px 14px' }}>
          <Logo />
        </div>
        <nav style={{ padding: '0 10px', display: 'grid', gap: 2, flex: 1, overflowY: 'auto' }}>
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')} end={it.to === '/dashboard'}>
              <Icon name={it.icon} />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid var(--muted)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px' }}>
            <span aria-hidden="true" style={{
              width: 34, height: 34, borderRadius: 999, flexShrink: 0,
              background: 'var(--brand-100)', color: 'var(--brand-700)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12.5, fontWeight: 700,
            }}>{initials}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me?.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me?.tenant?.name}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <ThemeToggle />
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={logout}>
              <Icon name="logout" /> Keluar
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="t-mobile-head">
        <Logo size={22} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <ThemeToggle />
          <button className="btn btn-ghost btn-sm" onClick={logout} aria-label="Keluar"><Icon name="logout" /></button>
        </div>
      </header>

      <main id="main" className="t-main">
        <Outlet />
      </main>

      {/* Bottom nav mobile */}
      <nav className="t-bottomnav" aria-label="Navigasi utama">
        {items.filter((it) => MOBILE_NAV.includes(it.to)).map((it) => (
          <NavLink key={it.to} to={it.to} className={({ isActive }) => 'bnitem' + (isActive ? ' active' : '')}>
            <Icon name={it.icon} />
            <span>{it.label.split(' ')[0]}</span>
          </NavLink>
        ))}
      </nav>

      <style>{`
        .t-sidebar { display: none; position: fixed; inset: 0 auto 0 0; width: 232px;
          background: var(--surface); border-right: 1px solid var(--muted);
          flex-direction: column; z-index: 20; }
        .t-mobile-head { position: sticky; top: 0; z-index: 25; display: flex; align-items: center;
          gap: 10px; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--muted); }
        .t-main { padding: 18px 14px calc(76px + env(safe-area-inset-bottom)); max-width: 1100px; margin: 0 auto; }
        .t-bottomnav { position: fixed; bottom: 0; left: 0; right: 0; z-index: 25;
          display: flex; background: var(--surface); border-top: 1px solid var(--muted);
          padding-bottom: env(safe-area-inset-bottom); }
        .bnitem { flex: 1; display: grid; justify-items: center; gap: 3px; padding: 9px 2px 8px;
          font-size: 10.5px; font-weight: 600; color: var(--text-faint); text-decoration: none; }
        .bnitem.active { color: var(--brand-600); }
        @media (min-width: 1025px) {
          .t-sidebar { display: flex; }
          .t-mobile-head, .t-bottomnav { display: none; }
          .t-main { margin-left: 232px; padding: 28px 32px 48px; }
        }
      `}</style>
    </div>
  );
}
