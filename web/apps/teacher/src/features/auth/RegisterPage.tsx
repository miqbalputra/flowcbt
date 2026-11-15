import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle } from '@flowcbt/ui';

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
      toast('Terdaftar! Paket trial 14 hari aktif. Silakan login (di mode dev email otomatis terverifikasi).', 'ok');
      nav('/login');
    } catch (err: any) {
      toast(err.message || 'Registrasi gagal', 'danger');
    } finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 460, margin: '6vh auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Daftar FlowCBT</h1><ThemeToggle />
      </div>
      <p style={{ color: 'var(--muted)' }}>Buat akun sekolah/lembaga — langsung dapat paket Gratis/Trial (1–10 siswa, 1 ujian, 14 hari).</p>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <label>Nama lengkap<Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Email<Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Nomor HP (opsional)<Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Password (min 8)<Input required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label>Nama sekolah/lembaga<Input required value={form.tenant_name} onChange={(e) => setForm({ ...form, tenant_name: e.target.value })} /></label>
          <label>Jenjang
            <select className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Button type="submit" disabled={busy}>{busy ? 'Mendaftar…' : 'Daftar (Gratis/Trial)'}</Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center' }}><Link to="/login">Sudah punya akun? Masuk</Link></p>
    </div>
  );
}
