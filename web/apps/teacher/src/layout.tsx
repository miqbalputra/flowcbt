import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApiQuery, logout as logoutAll } from '@flowcbt/api-client';
import { ThemeToggle } from '@flowcbt/ui';

const NAV = [
  ['/dashboard', 'Dashboard'],
  ['/students', 'Siswa'],
  ['/classes', 'Kelas'],
  ['/question-sets', 'Bank Soal'],
  ['/exams', 'Ujian'],
  ['/reports/live', 'Live'],
  ['/reports/history', 'Laporan'],
  ['/billing', 'Langganan'],
  ['/settings', 'Pengaturan'],
  ['/admin/tenants', 'Super Admin'],
];

// Layout guru/admin: sidebar di desktop, bottom nav di mobile (FR-11.2).
export default function Layout() {
  const nav = useNavigate();
  const { data: me } = useApiQuery<any>(['me'], '/auth/me');
  const logout = () => { void logoutAll().finally(() => nav('/login')); };
  return (
    <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--muted)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 20 }}>
        <strong style={{ fontSize: 18 }}>🎓 FlowCBT</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{me?.tenant?.name}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <ThemeToggle />
          <button className="btn btn-ghost" onClick={logout}>Keluar</button>
        </div>
      </header>
      <div style={{ display: 'flex', flex: 1 }}>
        <nav className="sidebar" style={{ width: 200, borderRight: '1px solid var(--muted)', padding: 12, display: 'none' }}>
          {NAV.filter(([p]) => !(p === '/admin/tenants' && me?.role !== 'super_admin')).map(([p, label]) => (
            <NavLink key={p} to={p} className="navlink" style={({ isActive }) => ({ display: 'block', padding: '10px 12px', borderRadius: 10, marginBottom: 4, textDecoration: 'none', color: isActive ? '#fff' : 'var(--text)', background: isActive ? 'var(--brand-600)' : 'transparent', fontWeight: 600 })}>
              {label}
            </NavLink>
          ))}
        </nav>
        <main style={{ flex: 1, padding: 16, minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
      <nav className="bottomnav" style={{ position: 'sticky', bottom: 0, display: 'flex', overflowX: 'auto', borderTop: '1px solid var(--muted)', background: 'var(--surface)' }}>
        {NAV.filter(([p]) => !(p === '/admin/tenants' && me?.role !== 'super_admin')).slice(0, 6).map(([p, label]) => (
          <NavLink key={p} to={p} style={({ isActive }) => ({ flex: 1, textAlign: 'center', padding: '10px 4px', fontSize: 12, textDecoration: 'none', color: isActive ? 'var(--brand-600)' : 'var(--text-muted)', fontWeight: 700, minWidth: 64 })}>
            {label}
          </NavLink>
        ))}
      </nav>
      <style>{`
        @media (min-width: 1025px) { .sidebar { display: block !important; } .bottomnav { display: none !important; } }
      `}</style>
    </div>
  );
}
