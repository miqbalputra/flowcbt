import React, { useState } from 'react';
import { api, useApiQuery, useApiMutation } from '@flowcbt/api-client';
import { Button, Input, Modal, useToast, SkeletonTableRows, PageHeader, EmptyState, Icon } from '@flowcbt/ui';

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
      <PageHeader
        title="Kelas"
        subtitle="Kelompokkan siswa per kelas untuk penugasan ujian."
        actions={<Button onClick={() => setOpen(true)}><Icon name="plus" /> Kelas</Button>}
      />
      <div className="table-wrap">
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
            {!error && (classes || []).length === 0 && <tr><td colSpan={4}><EmptyState icon="classes" title="Belum ada kelas">Buat kelas pertama, lalu isi dengan siswa.</EmptyState></td></tr>}
          </tbody>
            )}
        </table>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Kelas baru">
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="field"><span>Nama kelas</span><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="cth. IX A" /></label>
          <label className="field"><span>Tahun ajaran</span><Input value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="2026/2027" /></label>
          <Button onClick={submit}>Simpan</Button>
        </div>
      </Modal>
    </div>
  );
}
