import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, Badge, SkeletonTableRows, Button, PageHeader, EmptyState, Icon } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Track record siswa (FR-3.7): seluruh ujian, nilai, status — melekat ke siswa walau pindah kelas.
export default function StudentDetailPage() {
  const { id } = useParams();
  const { data: tr, isLoading } = useApiQuery<any>(['track-' + id], `/students/${id}/track-record`);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PageHeader
        title={tr?.name || 'Profil siswa'}
        subtitle={tr ? `Kode siswa ${tr.student_code} — seluruh riwayat ujian tercatat di sini.` : 'Memuat…'}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            <Link to="/students"><Button variant="ghost"><Icon name="chevron-left" /> Daftar siswa</Button></Link>
            <Button variant="ghost" onClick={() => history.back()}><Icon name="chevron-right" /> Sebelumnya</Button>
          </div>
        }
      />
      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ujian</th><th>Mapel</th><th>Percobaan</th><th>Nilai</th><th>Penalti</th><th>Status</th><th>Waktu</th></tr></thead>
            {isLoading ? (
              <SkeletonTableRows cols={7} rows={4} />
            ) : (
              <tbody>
                {(tr?.attempts || []).map((a: any, i: number) => (
                  <tr key={i}>
                    <td>{a.exam_name}</td><td>{a.subject}</td><td>#{a.attempt_no}</td>
                    <td><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{a.final_score ?? '—'}</strong></td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{a.penalty_points ? `-${a.penalty_points}` : '—'}</td>
                    <td><Badge tone={a.status === 'graded' ? 'ok' : 'muted'}>{a.status}</Badge></td>
                    <td>{fmtDateTime(a.started_at)}</td>
                  </tr>
                ))}
                {(tr?.attempts || []).length === 0 && <tr><td colSpan={7}><EmptyState icon="trophy" title="Belum ada ujian">Riwayat ujian siswa ini akan muncul di sini.</EmptyState></td></tr>}
              </tbody>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
