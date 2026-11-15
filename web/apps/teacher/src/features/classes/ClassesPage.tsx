import React, { useState } from 'react';
import { api, useApiQuery, useApiMutation } from '@flowcbt/api-client';
import { Button, Input, Card, Modal, useToast, Badge, SkeletonTableRows } from '@flowcbt/ui';

// CRUD kelas (FR-3.1).
export default function ClassesPage() {
  const toast = useToast();
  const { data: classes, refetch, error, isLoading } = useApiQuery<any[]>(['classes'], '/classes');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', academic_year: '2026/2027' });
  const create = useApiMutation(async (f: any) => { await api('POST', '/classes', f); });

  const submit = async () => {
    try {
      await create.mutateAsync(form);
      toast('Kelas dibuat', 'ok');
      setOpen(false); setForm({ name: '', academic_year: '2026/2027' });
      refetch();
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>Kelas</h1>
        <Button onClick={() => setOpen(true)}>+ Kelas</Button>
      </div>
      <Card style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Nama</th><th>Tahun ajaran</th><th>Siswa aktif</th><th></th></tr></thead>
          {isLoading
            ? <SkeletonTableRows cols={4} rows={4} />
            : (
            <tbody>
            {(classes || []).map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td><td>{c.academic_year}</td><td>{c.student_count}</td>
                <td><Button variant="ghost" onClick={async () => { await api('DELETE', `/classes/${c.id}`); refetch(); }}>Arsipkan</Button></td>
              </tr>
            ))}
            {!error && (classes || []).length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>Belum ada kelas.</td></tr>}
          </tbody>
            )}
        </table>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Kelas baru">
        <div style={{ display: 'grid', gap: 10 }}>
          <label>Nama kelas<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="X IPA 1" /></label>
          <label>Tahun ajaran<Input value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} /></label>
          <Button onClick={submit}>Simpan</Button>
        </div>
      </Modal>
    </div>
  );
}
