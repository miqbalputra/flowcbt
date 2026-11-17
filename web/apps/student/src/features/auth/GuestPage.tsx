import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setAccessToken, setRefreshToken } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle, Icon, Logo } from '@flowcbt/ui';

// Login tanpa akun (FR-1.3): data diri + kode ujian + token.
export default function GuestPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ exam_code: '', token: '', name: '', gender: 'L', class_name: '', nis: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<any>('POST', '/student/auth/guest', form, { token: false });
      setAccessToken(r.tokens.access_token);
      setRefreshToken(r.tokens.refresh_token);
      toast(r.student?.is_guest ? 'Masuk sebagai peserta tamu' : 'Data Anda cocok dengan siswa terdaftar', 'ok');
      nav('/exams');
    } catch (err: any) {
      toast(err.message || 'Login gagal', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-topbar"><span /><ThemeToggle /></div>
      <div className="auth-hero">
        <Logo />
        <h1>Ikuti ujian tanpa akun</h1>
        <p>Masukkan kode ujian dan token dari pengawas Anda.</p>
      </div>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            <span>Kode ujian</span>
            <Input required value={form.exam_code} onChange={(e) => setForm({ ...form, exam_code: e.target.value.toUpperCase() })} placeholder="cth. DEMO01" />
          </label>
          <label className="field">
            <span>Token ujian</span>
            <Input required value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value.toUpperCase() })} placeholder="6 huruf/angka" style={{ letterSpacing: '0.2em', fontWeight: 650, textAlign: 'center' }} />
          </label>
          <label className="field">
            <span>Nama lengkap</span>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama sesuai daftar presensi" />
          </label>
          <label className="field">
            <span>Jenis kelamin</span>
            <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="L">Laki-laki</option>
              <option value="P">Perempuan</option>
            </select>
          </label>
          <label className="field">
            <span>Kelas</span>
            <Input required value={form.class_name} onChange={(e) => setForm({ ...form, class_name: e.target.value })} placeholder="cth. IX A" />
          </label>
          <label className="field">
            <span>NIS <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>(bila diminta guru)</em></span>
            <Input value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? <Icon name="clock" /> : <Icon name="play" />}
            {busy ? 'Memproses…' : 'Masuk'}
          </Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center', marginTop: 18 }}><Link to="/login">Masuk dengan akun</Link></p>
    </div>
  );
}
