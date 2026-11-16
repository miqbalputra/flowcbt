import React from 'react';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, ThemeToggle, SkeletonList, PageHeader, Icon } from '@flowcbt/ui';

// Pengaturan: profil, tema (FR-11.1), info tenant.
export default function SettingsPage() {
  const { data: me, isLoading } = useApiQuery<any>(['me'], '/auth/me');
  const roleLabel: Record<string, string> = { admin: 'Admin sekolah', guru: 'Guru', teacher: 'Guru' };
  return (
    <div style={{ maxWidth: 640, display: 'grid', gap: 14 }}>
      <PageHeader title="Pengaturan" subtitle="Profil akun dan preferensi tampilan." />
      <Card>
        <div className="card-title" style={{ marginBottom: 10 }}>Profil</div>
        {isLoading ? (
          <SkeletonList rows={4} gap={10} />
        ) : me ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span className="field-label">Nama</span>
              <input className="input" value={me.name} readOnly />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" value={me.email} readOnly />
            </label>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <label className="field">
                <span className="field-label">Peran</span>
                <input className="input" value={roleLabel[me.role] || me.role} readOnly />
              </label>
              <label className="field">
                <span className="field-label">Sekolah / lembaga</span>
                <input className="input" value={me.tenant?.name || '-'} readOnly />
              </label>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="info" size={14} /> Kode lembaga: <strong>{me.tenant?.code}</strong> — dibutuhkan siswa saat login tanpa akun.
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>Gagal memuat profil.</div>
        )}
      </Card>
      <Card>
        <div className="card-title" style={{ marginBottom: 10 }}>Tampilan</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ThemeToggle />
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Terang · Gelap · Ikuti sistem</span>
        </div>
      </Card>
    </div>
  );
}
