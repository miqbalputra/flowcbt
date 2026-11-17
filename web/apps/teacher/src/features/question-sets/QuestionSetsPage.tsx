import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { api, useApiQuery, QueryError } from '@flowcbt/api-client';
import { Button, Card, Input, Modal, useToast, Badge, SkeletonList, PageHeader, EmptyState, Icon } from '@flowcbt/ui';
import { statusLabel, statusTone } from '@flowcbt/shared';

// Daftar paket soal (FR-4.1): cari, buat, duplikasi, arsip, publish/unpublish.
export default function QuestionSetsPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data: sets, refetch, error, isLoading } = useApiQuery<any[]>(['qs'], '/question-sets');
  const [open, setOpen] = useState(false);
  const [toArchive, setToArchive] = useState<any>(null);
  const [form, setForm] = useState({ subject_name: '', title: '', exam_code: '' });

  const mutate = async (path: string, method: string, label: string) => {
    try { await api(method as any, path, method === 'POST' ? {} : undefined); toast(label, 'ok'); refetch(); }
    catch (err: any) { toast(err.message, 'danger'); }
  };

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
        {error && <QueryError error={error} onRetry={refetch} />}
        {!isLoading && !error && list.map((s) => (
          <Card key={s.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <Link to={`/question-sets/${s.id}/edit`}><strong>{s.title}</strong></Link> <Badge>{s.subject_name}</Badge> <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>kode ujian {s.exam_code} · {s.question_count} soal · {s.max_points} poin</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.status === 'published'
                  ? <Button variant="ghost" aria-label={`Unpublish ${s.title}`} onClick={() => void mutate(`/question-sets/${s.id}/unpublish`, 'POST', `${s.title} di-unpublish`)}>Unpublish</Button>
                  : <Button aria-label={`Publish ${s.title}`} onClick={() => void mutate(`/question-sets/${s.id}/publish`, 'POST', `${s.title} dipublish`)}>Publish</Button>}
                <Button variant="ghost" aria-label={`Duplikat ${s.title}`} onClick={() => void mutate(`/question-sets/${s.id}/duplicate`, 'POST', `${s.title} diduplikat`)}>Duplikat</Button>
                <Button variant="ghost" aria-label={`Arsipkan ${s.title}`} onClick={() => setToArchive(s)}>Arsipkan</Button>
              </div>
            </div>
          </Card>
        ))}
        {!error && !isLoading && list.length === 0 && <Card><EmptyState icon="bank" title="Belum ada paket soal">Buat paket soal pertama — cukup 5 menit.</EmptyState></Card>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Paket soal baru">
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="field"><span>Mata pelajaran</span><Input value={form.subject_name} onChange={(e) => setForm({ ...form, subject_name: e.target.value })} placeholder="cth. Matematika" /></label>
          <label className="field"><span>Judul paket</span><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="cth. Ulangan Harian Bab 1" /></label>
          <label className="field"><span>Kode ujian <em style={{ fontStyle: 'normal', color: 'var(--text-muted)' }}>(kosongkan untuk otomatis)</em></span><Input value={form.exam_code} onChange={(e) => setForm({ ...form, exam_code: e.target.value.toUpperCase() })} /></label>
          <Button onClick={async () => {
            try {
              const r = await api<any>('POST', '/question-sets', form);
              setOpen(false);
              nav(`/question-sets/${r.id}/edit`);
            } catch (err: any) { toast(err.message, 'danger'); }
          }}>Buat & buka editor</Button>
        </div>
      </Modal>
      {toArchive && (
        <Modal open onClose={() => setToArchive(null)} title="Arsipkan paket soal">
          <p>Paket <strong>{toArchive.title}</strong> akan diarsipkan.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setToArchive(null)}>Batal</Button>
            <Button variant="danger" onClick={() => { const s = toArchive; setToArchive(null); void mutate(`/question-sets/${s.id}`, 'DELETE', `${s.title} diarsipkan`); }}>Ya, arsipkan</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
