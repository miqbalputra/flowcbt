import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Input, Modal, useToast, Badge, SkeletonList, PageHeader, EmptyState, Icon } from '@flowcbt/ui';

// Daftar paket soal (FR-4.1): cari, buat, duplikasi, arsip, publish/unpublish.
export default function QuestionSetsPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data: sets, refetch, error, isLoading } = useApiQuery<any[]>(['qs'], '/question-sets');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject_name: '', title: '', exam_code: '' });

  const list = (sets || []).filter((s) => !q || (s.title + s.subject_name).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Bank Soal"
        subtitle="Kumpulan paket soal per mata pelajaran."
        actions={<Button onClick={() => setOpen(true)}><Icon name="plus" /> Paket Soal</Button>}
      />
      <Input placeholder="Cari paket atau mata pelajaran…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, margin: '0 0 12px' }} />
      <div style={{ display: 'grid', gap: 10 }}>
        {isLoading && <SkeletonList rows={4} />}
        {error && <Card><span style={{ color: 'var(--text-muted)' }}>Gagal memuat paket soal.</span></Card>}
        {!isLoading && list.map((s) => (
          <Card key={s.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <Link to={`/question-sets/${s.id}/edit`}><strong>{s.title}</strong></Link> <Badge>{s.subject_name}</Badge>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>kode ujian {s.exam_code} · {s.question_count} soal · {s.max_points} poin</div>
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
        {!error && list.length === 0 && <Card><EmptyState icon="bank" title="Belum ada paket soal">Buat paket soal pertama — cukup 5 menit.</EmptyState></Card>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Paket soal baru">
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="field"><span>Mata pelajaran</span><Input value={form.subject_name} onChange={(e) => setForm({ ...form, subject_name: e.target.value })} placeholder="cth. Matematika" /></label>
          <label className="field"><span>Judul paket</span><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="cth. Ulangan Harian Bab 1" /></label>
          <label className="field"><span>Kode ujian <em style={{ fontStyle: 'normal', color: 'var(--text-faint)' }}>(kosongkan untuk otomatis)</em></span><Input value={form.exam_code} onChange={(e) => setForm({ ...form, exam_code: e.target.value.toUpperCase() })} /></label>
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
