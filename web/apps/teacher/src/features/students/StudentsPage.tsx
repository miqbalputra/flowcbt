import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Modal, useToast, Badge, Input, SkeletonTableRows } from '@flowcbt/ui';
import { API_BASE } from '@flowcbt/api-client';

// Manajemen siswa (FR-3.2/3.3/3.4): tabel→kartu di mobile, import 3 langkah (template→preview→commit, AC-10), export.
export default function StudentsPage() {
  const toast = useToast();
  const { data: students, refetch, error: errStudents, isLoading: lStudents } = useApiQuery<any[]>(['students'], '/students?guests=1');
  const { data: classes } = useApiQuery<any[]>(['classes'], '/classes');
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [jobId, setJobId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [credModal, setCredModal] = useState<{ name: string; username: string; password: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  const doResetPassword = async (s: any) => {
    setResetting(true);
    try {
      const r = await api<any>('POST', `/students/${s.id}/reset-password`, {});
      setCredModal({ name: s.name, username: r.username || s.username || '-', password: r.new_password || r.password || '-' });
      refetch();
    } catch (err: any) { toast(err.message || 'Gagal mereset password', 'danger'); }
    finally { setResetting(false); }
  };

  const list = (students || []).filter((s) =>
    (!q || s.name.toLowerCase().includes(q.toLowerCase()) || s.student_code.includes(q)) &&
    (!classFilter || s.class_id === classFilter));

  const doPreview = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return toast('Pilih file .xlsx/.csv dulu', 'danger');
    const fd = new FormData();
    fd.append('file', f);
    const token = (await import('@flowcbt/api-client')).getAccessToken();
    const res = await fetch(API_BASE + '/students/import/preview', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
    const j = await res.json();
    setPreview(j.data); setJobId(j.data.job_id);
  };

  const doCommit = async () => {
    try {
      const r = await api<any>('POST', '/students/import/commit', { job_id: jobId });
      toast(`Import selesai: ${r.created} siswa dibuat`, 'ok');
      setImportOpen(false); setPreview(null); refetch();
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', gender: 'L', class_id: '', nis: '' });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22 }}>Siswa</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`${API_BASE}/students/import/template`}><Button variant="ghost">Unduh template</Button></a>
          <Button variant="ghost" onClick={() => setImportOpen(true)}>Import</Button>
          <a href={`${API_BASE}/students/export`}><Button variant="ghost">Export</Button></a>
          <Button onClick={() => setAddOpen(true)}>+ Siswa</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <Input placeholder="Cari nama/kode…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
        <select className="input" style={{ maxWidth: 180 }} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          <option value="">Semua kelas</option>
          {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Nama</th><th>Kode</th><th>Kelas</th><th>JK</th><th>Username</th><th></th></tr></thead>
          {lStudents
            ? <SkeletonTableRows cols={6} rows={6} />
            : (
            <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/students/${s.id}`}><strong>{s.name}</strong></Link> {s.is_guest && <Badge tone="warn">tamu</Badge>}</td>
                <td>{s.student_code}</td><td>{s.class_name}</td><td>{s.gender}</td><td>{s.username || '-'}</td>
                <td><Button variant="ghost" disabled={resetting} onClick={() => doResetPassword(s)}>{resetting ? '…' : 'Reset pw'}</Button></td>
              </tr>
            ))}
            {!errStudents && list.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>Tidak ada data.</td></tr>}
          </tbody>
            )}
        </table>
      </Card>

      <Modal open={importOpen} onClose={() => { setImportOpen(false); setPreview(null); }} title="Import siswa (3 langkah)">
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" />
            <Button variant="ghost" onClick={doPreview} style={{ marginLeft: 8 }}>1. Preview & validasi</Button>
          </div>
          {preview && (
            <div>
              <Badge tone="ok">Valid: {preview.valid}</Badge> <Badge tone="danger">Error: {preview.invalid}</Badge>
              {preview.errors?.length > 0 && (
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Baris</th><th>Alasan</th></tr></thead>
                  <tbody>{preview.errors.map((e: any) => <tr key={e.row}><td>{e.row}</td><td>{e.reason}</td></tr>)}</tbody>
                </table>
              )}
              <Button onClick={doCommit} style={{ marginTop: 8 }}>2. Konfirmasi & simpan ({preview.valid} baris)</Button>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Tambah siswa">
        <div style={{ display: 'grid', gap: 10 }}>
          <label>Nama<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Jenis kelamin
            <select className="input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="L">L</option><option value="P">P</option>
            </select>
          </label>
          <label>Kelas
            <select className="input" value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}>
              <option value="">Pilih…</option>
              {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>NIS (opsional)<Input value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} /></label>
          <Button onClick={async () => {
            try {
              const r = await api<any>('POST', '/students', form);
              toast(`Siswa dibuat. Username: ${r.username}, password: ${r.password}`, 'ok');
              setAddOpen(false); refetch();
            } catch (err: any) { toast(err.message, 'danger'); }
          }}>Simpan</Button>
        </div>
      </Modal>

      <Modal open={!!credModal} onClose={() => setCredModal(null)} title={`Password baru — ${credModal?.name || ''}`}>
        {credModal && (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>Password lama tidak berlaku lagi. Berikan kredensial berikut ke siswa:</p>
            <div>
              <strong>Username</strong>
              <div className="card" style={{ padding: '8px 12px', userSelect: 'all' }}>{credModal.username}</div>
            </div>
            <div>
              <strong>Password baru</strong>
              <div className="card" style={{ padding: '8px 12px', userSelect: 'all' }}>{credModal.password}</div>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--warn)' }}>Password ini hanya ditampilkan sekali. Catat sebelum menutup dialog ini.</p>
            <Button onClick={() => {
              navigator.clipboard?.writeText(`Username: ${credModal.username}\nPassword: ${credModal.password}`).then(
                () => toast('Kredensial disalin', 'ok'),
                () => toast('Gagal menyalin — salin manual', 'danger'),
              );
            }}>Salin kredensial</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
