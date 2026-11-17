import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setAccessToken, setRefreshToken } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle, Icon, Logo } from '@flowcbt/ui';

export default function LoginPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<any>('POST', '/auth/login', form, { token: false });
      setAccessToken(r.tokens.access_token);
      setRefreshToken(r.tokens.refresh_token);
      nav('/dashboard');
    } catch (err: any) {
      toast(err.message || 'Login gagal. Periksa email dan password Anda.', 'danger');
    } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <div className="auth-topbar"><span /><ThemeToggle /></div>
      <div className="auth-hero">
        <Logo />
        <h1>Selamat datang kembali</h1>
        <p>Masuk untuk mengelola soal, ujian, dan nilai sekolah Anda.</p>
      </div>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            <span>Email</span>
            <Input required type="email" autoComplete="email" placeholder="nama@sekolah.sch.id"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            <span>Password</span>
            <Input required type="password" autoComplete="current-password" placeholder="Password Anda"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? <Icon name="clock" /> : <Icon name="key" />}
            {busy ? 'Memproses…' : 'Masuk'}
          </Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 18 }}>
        Belum punya akun? <Link to="/register">Daftarkan sekolah Anda</Link>
      </p>
    </div>
  );
}
