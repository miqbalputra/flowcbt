import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Input, Modal, useToast, Badge } from '@flowcbt/ui';

// Daftar paket soal (FR-4.1): cari, buat, duplikasi, arsip, publish/unpublish.
export default function QuestionSetsPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data: sets, refetch } = useApiQuery<any[]>(['qs'], '/question-sets');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject_name: '', title: '', exam_code: '' });

  const list = (sets || []).filter((s) => !q || (s.title + s.subject_name).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22 }}>Bank Soal</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => setOpen(true)}>+ Paket soal</Button>
        </div>
      </div>
      <Input placeholder="Cari paket/mapel…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300, margin: '10px 0' }} />
      <div style={{ display: 'grid', gap: 10 }}>
        {list.map((s) => (
          <Card key={s.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <Link to={`/question-sets/${s.id}/edit`}><strong>{s.title}</strong></Link> <Badge>{s.subject_name}</Badge>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>kode ujian {s.exam_code} · {s.question_count} soal · {s.max_points} poin</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.status === 'published'
                  ? <Button variant="ghost" onClick={async () => { await api('POST', `/question-sets/${s.id}/unpublish`, {}); refetch(); }}>Unpublish</Button>
                  : <Button onClick={async () => { try { await api('POST', `/question-sets/${s.id}/publish`, {}); toast('Dipublish', 'ok'); } catch (e: any) { toast(e.message, 'danger'); } refetch(); }}>Publish</Button>}
                <Button variant="ghost" onClick={async () => { await api('POST', `/question-sets/${s.id}/duplicate`, {}); refetch(); }}>Duplikat</Button>
                <Button variant="ghost" onClick={async () => { await api('DELETE', `/question-sets/${s.id}`); refetch(); }}>Arsipkan</Button>
              </div>
            </div>
          </Card>
        ))}
        {list.length === 0 && <Card>Belum ada paket soal. Klik “+ Paket soal”.</Card>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Paket soal baru">
        <div style={{ display: 'grid', gap: 10 }}>
          <label>Mata pelajaran<Input value={form.subject_name} onChange={(e) => setForm({ ...form, subject_name: e.target.value })} /></label>
          <label>Judul paket<Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="UH Bab 1" /></label>
          <label>Kode ujian (kosongkan untuk otomatis)<Input value={form.exam_code} onChange={(e) => setForm({ ...form, exam_code: e.target.value.toUpperCase() })} /></label>
          <Button onClick={async () => {
            try {
              const r = await api<any>('POST', '/question-sets', form);
              setOpen(false);
              nav(`/question-sets/${r.id}/edit`);
            } catch (err: any) { toast(err.message, 'danger'); }
          }}>Buat & buka editor</Button>
        </div>
      </Modal>
    </div>
  );
}
