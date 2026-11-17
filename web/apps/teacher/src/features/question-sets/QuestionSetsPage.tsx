import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { api, useApiQuery, QueryError } from '@flowcbt/api-client';
import { Button, Card, Input, Modal, useToast, Badge, SkeletonTableRows, PageHeader, EmptyState, Icon, DataTableToolbar, SortTh, type SortState } from '@flowcbt/ui';
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

  const [sort, setSort] = useState<SortState>({ col: 'title', dir: 'asc' });
  const [selected, setSelected] = useState<string[]>([]);
  const onSort = (col: string) => setSort((v) => ({ col, dir: v.col === col && v.dir === 'asc' ? 'desc' : 'asc' }));
  const list = useMemo(() => {
    const arr = (sets || []).filter((s) => !q || (s.title + s.subject_name).toLowerCase().includes(q.toLowerCase()));
    arr.sort((a, b) => {
      const av = sort.col === 'question_count' ? (a.question_count || 0) : String(a[sort.col] || '').toLowerCase();
      const bv = sort.col === 'question_count' ? (b.question_count || 0) : String(b[sort.col] || '').toLowerCase();
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [sets, q, sort]);
  const allSelected = list.length > 0 && selected.length === list.length;

  const batchArchive = async () => {
    for (const id of selected) await api('DELETE', `/question-sets/${id}`).catch(() => {});
    toast(`${selected.length} paket diarsipkan`, 'ok');
    setSelected([]); refetch();
  };

  return (
    <div>
      <PageHeader
        title="Bank Soal"
        subtitle="Kumpulan paket soal per mata pelajaran."
        actions={<Button onClick={() => setOpen(true)}><Icon name="plus" /> Paket Soal</Button>}
      />
      <DataTableToolbar>
        <Input placeholder="Cari paket atau mata pelajaran…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{list.length} paket</span>
      </DataTableToolbar>
      {selected.length > 0 && (
        <div className="batch-bar" style={{ marginBottom: 8 }}>
          <strong>{selected.length}</strong> paket terpilih
          <Button variant="ghost" onClick={batchArchive}><Icon name="trash" /> Arsipkan</Button>
          <Button variant="ghost" onClick={() => setSelected([])}>Batal</Button>
        </div>
      )}
      {isLoading && <div className="table-wrap"><table className="table"><tbody><SkeletonTableRows cols={6} rows={4} /></tbody></table></div>}
      {error && <QueryError error={error} onRetry={refetch} />}
      {!isLoading && !error && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" className="table-check" aria-label="Pilih semua paket" checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? list.map((s) => s.id) : [])} /></th>
              <SortTh label="Paket soal" col="title" sort={sort} onSort={onSort} />
              <th>Mata pelajaran</th>
              <SortTh label="Soal" col="question_count" sort={sort} onSort={onSort} className="num" />
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Aksi</th>
            </tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td><input type="checkbox" className="table-check" aria-label={`Pilih ${s.title}`} checked={selected.includes(s.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} /></td>
                  <td><Link to={`/question-sets/${s.id}/edit`} style={{ fontWeight: 600 }}>{s.title}</Link><div className="card-sub mono">kode {s.exam_code}</div></td>
                  <td>{s.subject_name}</td>
                  <td className="num">{s.question_count} · {s.max_points} poin</td>
                  <td><Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge></td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {s.status === 'published'
                        ? <Button variant="ghost" aria-label={`Unpublish ${s.title}`} onClick={() => void mutate(`/question-sets/${s.id}/unpublish`, 'POST', `${s.title} di-unpublish`)}>Unpublish</Button>
                        : <Button variant="ghost" aria-label={`Publish ${s.title}`} onClick={() => void mutate(`/question-sets/${s.id}/publish`, 'POST', `${s.title} dipublish`)}>Publish</Button>}
                      <Button variant="ghost" aria-label={`Duplikat ${s.title}`} onClick={() => void mutate(`/question-sets/${s.id}/duplicate`, 'POST', `${s.title} diduplikat`)}>Duplikat</Button>
                      <Button variant="ghost" aria-label={`Arsipkan ${s.title}`} onClick={() => setToArchive(s)}>Arsipkan</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6}><EmptyState icon="bank" title="Belum ada paket soal">Buat paket soal pertama — cukup 5 menit.</EmptyState></td></tr>}
            </tbody>
          </table>
        </div>
      )}
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
