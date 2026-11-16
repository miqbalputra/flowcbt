import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery, QueryError } from '@flowcbt/api-client';
import { Card, Input, Badge, SkeletonList, PageHeader, EmptyState, Button } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Laporan historis (FR-9.6/9.7): daftar ujian + pencarian.
export default function HistoryReportPage() {
  const [q, setQ] = useState('');
  const { data: rows, refetch, error, isLoading } = useApiQuery<any[]>(['hist', q], `/reports/history?q=${encodeURIComponent(q)}`);
  return (
    <div>
      <PageHeader title="Hasil & Rekap" subtitle="Riwayat ujian yang sudah atau sedang berlangsung." />
      <Input placeholder="Cari nama, mapel, atau kode ujian…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, margin: '0 0 12px' }} />
      {isLoading && <div><SkeletonList rows={5} /></div>}
      {!isLoading && (
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Ujian</th><th>Mapel</th><th>Kode</th><th>Status</th><th>Percobaan</th><th>Rata-rata</th><th></th></tr></thead>
          <tbody>
            {(rows || []).map((e) => (
              <tr key={e.exam_id}>
                <td><strong>{e.name}</strong></td><td>{e.subject}</td><td>{e.exam_code}</td>
                <td><Badge>{e.status}</Badge></td><td>{e.attempts}</td>
                <td>{e.avg_score != null ? Number(e.avg_score).toFixed(2) : '-'}</td>
                <td><Link to={`/reports/exams/${e.exam_id}`}><Button variant="ghost">Lihat detail</Button></Link></td>
              </tr>
            ))}
            {(rows || []).length === 0 && ((error ? <tr><td colSpan={7}><QueryError error={error} onRetry={refetch} /></td></tr> : <tr><td colSpan={7}><EmptyState icon="trophy" title="Belum ada laporan">Laporan muncul setelah siswa mulai mengerjakan ujian.</EmptyState></td></tr>))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
