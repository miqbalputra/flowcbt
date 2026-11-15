import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setAccessToken, setRefreshToken } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle } from '@flowcbt/ui';

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
      toast(err.message || 'Login gagal', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '8vh auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>FlowCBT</h1>
        <ThemeToggle />
      </div>
      <p style={{ color: 'var(--text-muted)' }}>Login siswa dengan akun</p>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <label>Kode sekolah
            <Input required value={form.tenant_code} onChange={(e) => setForm({ ...form, tenant_code: e.target.value.toUpperCase() })} placeholder="mis. SBUL4W" />
          </label>
          <label>Username
            <Input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>Password
            <Input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <Button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center', marginTop: 16 }}>
        Tidak punya akun? <Link to="/guest">Masuk sebagai peserta (kode ujian + token)</Link>
      </p>
    </div>
  );
}
