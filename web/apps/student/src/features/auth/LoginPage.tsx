import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setAccessToken, setRefreshToken } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle, Icon, Logo } from '@flowcbt/ui';

export default function LoginPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ tenant_code: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<any>('POST', '/student/auth/login', form, { token: false });
      setAccessToken(r.tokens.access_token);
      setRefreshToken(r.tokens.refresh_token);
      nav('/exams');
    } catch (err: any) {
      toast(err.message || 'Login gagal. Periksa kode sekolah, username, dan password Anda.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-topbar"><span /><ThemeToggle /></div>
      <div className="auth-hero">
        <Logo />
        <h1>Masuk untuk mengerjakan ujian</h1>
        <p>Gunakan akun yang diberikan sekolah Anda.</p>
      </div>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            <span>Kode sekolah</span>
            <Input required value={form.tenant_code} onChange={(e) => setForm({ ...form, tenant_code: e.target.value.toUpperCase() })} placeholder="cth. 7HERWX" />
          </label>
          <label className="field">
            <span>Username</span>
            <Input required autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label className="field">
            <span>Password</span>
            <Input required type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? <Icon name="clock" /> : <Icon name="play" />}
            {busy ? 'Memproses…' : 'Masuk'}
          </Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 18 }}>
        Tidak punya akun? <Link to="/guest">Masuk dengan kode ujian</Link>
      </p>
    </div>
  );
}
