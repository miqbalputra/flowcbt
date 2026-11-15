import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, Badge, SkeletonTableRows } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Track record siswa (FR-3.7): seluruh ujian, nilai, status.
export default function StudentDetailPage() {
  const { id } = useParams();
  const { data: tr, isLoading } = useApiQuery<any>(['track-' + id], `/students/${id}/track-record`);
  return (
    <div>
      <h1 style={{ fontSize: 22 }}>{tr?.name} <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{tr?.student_code}</span></h1>
      <Card style={{ marginTop: 12 }}>
        <table className="table">
          <thead><tr><th>Ujian</th><th>Mapel</th><th>Percobaan</th><th>Nilai</th><th>Penalti</th><th>Status</th><th>Waktu</th></tr></thead>
          {isLoading
            ? <SkeletonTableRows cols={7} rows={4} />
            : (
            <tbody>
            {(tr?.attempts || []).map((a: any, i: number) => (
              <tr key={i}>
                <td>{a.exam_name}</td><td>{a.subject}</td><td>#{a.attempt_no}</td>
                <td><strong>{a.final_score ?? '-'}</strong></td><td>{a.penalty_points || 0}</td>
                <td><Badge tone={a.status === 'graded' ? 'ok' : 'muted'}>{a.status}</Badge></td>
                <td>{fmtDateTime(a.started_at)}</td>
              </tr>
            ))}
            {(tr?.attempts || []).length === 0 && <tr><td colSpan={7} style={{ color: 'var(--text-muted)' }}>Belum ada ujian.</td></tr>}
          </tbody>
            )}
        </table>
      </Card>
      <p style={{ marginTop: 10 }}><Link to="/students">← Kembali ke daftar siswa</Link></p>
    </div>
  );
}
