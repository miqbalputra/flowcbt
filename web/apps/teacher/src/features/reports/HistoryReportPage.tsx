import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, Input, Badge } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Laporan historis (FR-9.6/9.7): daftar ujian + pencarian.
export default function HistoryReportPage() {
  const [q, setQ] = useState('');
  const { data: rows } = useApiQuery<any[]>(['hist', q], `/reports/history?q=${encodeURIComponent(q)}`);
  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Laporan Ujian</h1>
      <Input placeholder="Cari nama/mapel/kode ujian…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, margin: '10px 0' }} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Ujian</th><th>Mapel</th><th>Kode</th><th>Status</th><th>Percobaan</th><th>Rata-rata</th><th></th></tr></thead>
          <tbody>
            {(rows || []).map((e) => (
              <tr key={e.exam_id}>
                <td><strong>{e.name}</strong></td><td>{e.subject}</td><td>{e.exam_code}</td>
                <td><Badge>{e.status}</Badge></td><td>{e.attempts}</td>
                <td>{e.avg_score != null ? Number(e.avg_score).toFixed(2) : '-'}</td>
                <td><Link to={`/reports/exams/${e.exam_id}`}>Detail →</Link></td>
              </tr>
            ))}
            {(rows || []).length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>Belum ada laporan.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
