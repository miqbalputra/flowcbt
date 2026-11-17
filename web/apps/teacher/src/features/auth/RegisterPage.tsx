import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle, Icon, Logo } from '@flowcbt/ui';

const LEVELS = [['paud_tk', 'PAUD/TK'], ['sd_mi', 'SD/MI'], ['smp_mts', 'SMP/MTs'], ['sma_smk_ma', 'SMA/SMK/MA'], ['perguruan_tinggi', 'Perguruan Tinggi'], ['kursus_bimbel', 'Kursus/Bimbel'], ['lainnya', 'Lainnya']];

// Registrasi admin/guru (FR-1.1): buat tenant + paket trial otomatis.
export default function RegisterPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', tenant_name: '', level: 'sma_smk_ma' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/auth/register', form, { token: false });
      toast('Pendaftaran berhasil! Paket trial 14 hari aktif. Silakan masuk.', 'ok');
      nav('/login');
    } catch (err: any) {
      toast(err.message || 'Pendaftaran gagal. Coba email berbeda.', 'danger');
    } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <div className="auth-topbar"><span /><ThemeToggle /></div>
      <div className="auth-hero">
        <Logo />
        <h1>Daftarkan sekolah Anda</h1>
        <p>Gratis 14 hari — 1–10 siswa, 1 ujian. Tanpa kartu kredit.</p>
      </div>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            <span>Nama lengkap</span>
            <Input required value={form.name} placeholder="cth. Budi Santoso"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Email</span>
            <Input required type="email" autoComplete="email" placeholder="nama@sekolah.sch.id"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            <span>Nomor HP <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>(opsional)</em></span>
            <Input value={form.phone} placeholder="08xx xxxx xxxx"
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="field">
            <span>Password <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>(minimal 8 huruf)</em></span>
            <Input required type="password" minLength={8} autoComplete="new-password" placeholder="Buat password yang kuat"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="field">
            <span>Nama sekolah / lembaga</span>
            <Input required value={form.tenant_name} placeholder="cth. SMP Nusantara"
              onChange={(e) => setForm({ ...form, tenant_name: e.target.value })} />
          </label>
          <label className="field">
            <span>Jenjang</span>
            <select className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Button type="submit" disabled={busy}>
            <Icon name="plus" />
            {busy ? 'Mendaftarkan…' : 'Mulai gratis'}
          </Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center', marginTop: 18 }}>
        <Link to="/login">Sudah punya akun? Masuk</Link>
      </p>
    </div>
  );
}
