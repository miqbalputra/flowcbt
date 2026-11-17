import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery, QueryError } from '@flowcbt/api-client';
import { Button, Badge, SkeletonTableRows, PageHeader, EmptyState, Icon, Input, DataTableToolbar, SortTh, type SortState } from '@flowcbt/ui';
import { fmtDateTime, statusLabel, statusTone } from '@flowcbt/shared';

export default function ExamsPage() {
  const { data: exams, refetch, error, isLoading } = useApiQuery<any[]>(['exams'], '/exams');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState>({ col: 'open_at', dir: 'desc' });
  const onSort = (col: string) => setSort((v) => ({ col, dir: v.col === col && v.dir === 'asc' ? 'desc' : 'asc' }));

  const list = useMemo(() => {
    const arr = (exams || []).filter((e) => !q || (e.name + e.question_set_title).toLowerCase().includes(q.toLowerCase()));
    arr.sort((a, b) => {
      const av = sort.col === 'name' ? String(a.name || '').toLowerCase() : String(a[sort.col] || '');
      const bv = sort.col === 'name' ? String(b.name || '').toLowerCase() : String(b[sort.col] || '');
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [exams, q, sort]);

  return (
    <div>
      <PageHeader
        title="Ujian"
        subtitle="Jadwalkan paket soal menjadi sesi ujian."
        actions={<Link to="/exams/new"><Button><Icon name="plus" /> Ujian Baru</Button></Link>}
      />
      <DataTableToolbar>
        <Input placeholder="Cari ujian atau paket soal…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{list.length} ujian</span>
      </DataTableToolbar>
      {error && <QueryError error={error} onRetry={refetch} />}
      {isLoading && <div className="table-wrap"><table className="table"><tbody><SkeletonTableRows cols={6} rows={4} /></tbody></table></div>}
      {!isLoading && !error && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <SortTh label="Ujian" col="name" sort={sort} onSort={onSort} />
              <th>Paket soal</th>
              <SortTh label="Dibuka" col="open_at" sort={sort} onSort={onSort} />
              <th>Durasi</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Aksi</th>
            </tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/exams/${e.id}`} style={{ fontWeight: 600 }}>{e.name}</Link>
                    {e.token && <div className="card-sub mono">token {e.token}</div>}
                  </td>
                  <td>{e.question_set_title}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{fmtDateTime(e.open_at)}</td>
                  <td className="num">{e.duration_minutes} mnt</td>
                  <td><Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge></td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <Link to={`/exams/${e.id}`}><Button variant="ghost">Detail</Button></Link>
                      {e.status === 'published' && <Link to={`/exams/${e.id}/cheating`}><Button variant="ghost">Curang</Button></Link>}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6}><EmptyState icon="exams" title="Belum ada ujian">Pilih paket soal yang sudah dipublish, lalu atur jadwalnya.</EmptyState></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
