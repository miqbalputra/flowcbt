import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setAccessToken, setRefreshToken } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle } from '@flowcbt/ui';

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
      toast(err.message || 'Login gagal', 'danger');
    } finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 420, margin: '10vh auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>🎓 FlowCBT</h1><ThemeToggle />
      </div>
      <p style={{ color: 'var(--text-muted)' }}>Masuk sebagai guru/admin sekolah</p>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <label>Email<Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Password<Input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <Button type="submit" disabled={busy}>{busy ? '…' : 'Masuk'}</Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center' }}>Belum punya akun? <Link to="/register">Daftar sekolah baru</Link></p>
    </div>
  );
}
