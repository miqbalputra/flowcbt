import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setAccessToken, setRefreshToken } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, ThemeToggle } from '@flowcbt/ui';

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
    <div style={{ maxWidth: 420, margin: '8vh auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>FlowCBT</h1>
        <ThemeToggle />
      </div>
      <p style={{ color: 'var(--text-muted)' }}>Masuk tanpa akun (peserta ujian)</p>
      <Card>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <label>Kode ujian
            <Input required value={form.exam_code} onChange={(e) => setForm({ ...form, exam_code: e.target.value.toUpperCase() })} placeholder="mis. MTK01" />
          </label>
          <label>Token ujian
            <Input required value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value.toUpperCase() })} placeholder="6 karakter" />
          </label>
          <label>Nama lengkap
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>Jenis kelamin
            <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="L">Laki-laki</option>
              <option value="P">Perempuan</option>
            </select>
          </label>
          <label>Kelas
            <Input required value={form.class_name} onChange={(e) => setForm({ ...form, class_name: e.target.value })} placeholder="mis. X IPA 1" />
          </label>
          <label>NIS (bila diminta)
            <Input value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} />
          </label>
          <Button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</Button>
        </form>
      </Card>
      <p style={{ textAlign: 'center', marginTop: 16 }}><Link to="/login">Login dengan akun</Link></p>
    </div>
  );
}
