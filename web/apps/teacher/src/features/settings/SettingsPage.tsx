import React from 'react';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, ThemeToggle } from '@flowcbt/ui';

// Pengaturan: profil, tema (FR-11.1), info tenant.
export default function SettingsPage() {
  const { data: me } = useApiQuery<any>(['me'], '/auth/me');
  return (
    <div style={{ maxWidth: 560, display: 'grid', gap: 12 }}>
      <h1 style={{ fontSize: 22 }}>Pengaturan</h1>
      <Card>
        <strong>Profil</strong>
        <div style={{ marginTop: 8 }}>Nama: {me?.name}</div>
        <div>Email: {me?.email}</div>
        <div>Peran: {me?.role}</div>
        <div>Sekolah: {me?.tenant?.name} (kode {me?.tenant?.code})</div>
      </Card>
      <Card>
        <strong>Tema</strong>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <ThemeToggle /> <span style={{ color: 'var(--muted)', fontSize: 14 }}>terang / gelap / sistem</span>
        </div>
      </Card>
    </div>
  );
}
