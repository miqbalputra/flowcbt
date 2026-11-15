import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Badge, useToast, SkeletonList } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Laporan kecurangan per ujian (FR-5.8C): linimasa pelanggaran + keputusan guru (Valid / Batalkan penalti / Diskualifikasi).
export default function CheatingPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: rows, refetch, isLoading } = useApiQuery<any[]>(['cheat-' + id], `/exams/${id}/cheating-report`);

  const decide = async (attemptId: string, decision: string) => {
    try {
      await api('PUT', `/attempts/${attemptId}/cheating-decision`, { decision, reason: 'keputusan guru' });
      toast('Keputusan tersimpan', 'ok');
      refetch();
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Laporan Kecurangan</h1>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {isLoading && <SkeletonList rows={3} height={26} />}
        {!isLoading && (rows || []).map((r) => (
          <Card key={r.attempt_id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>{r.name}</strong> <Badge tone="danger">{r.violation_count} pelanggaran</Badge> <Badge tone={r.cheating_status === 'flagged' ? 'danger' : 'muted'}>{r.cheating_status}</Badge>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Penalti: {r.penalty_points} · Nilai akhir: {r.final_score ?? '-'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button variant="ghost" onClick={() => decide(r.attempt_id, 'valid')}>Valid</Button>
                <Button variant="ghost" onClick={() => decide(r.attempt_id, 'penalty_cancelled')}>Batalkan penalti</Button>
                <Button variant="danger" onClick={() => decide(r.attempt_id, 'disqualified')}>Diskualifikasi</Button>
              </div>
            </div>
            <table className="table" style={{ marginTop: 8 }}>
              <thead><tr><th>Waktu</th><th>Jenis</th><th>Durasi</th><th>Dihitung</th><th>Penalti</th></tr></thead>
              <tbody>
                {(r.violations || []).map((v: any, i: number) => (
                  <tr key={i}><td>{fmtDateTime(v.started_at)}</td><td>{v.type}</td><td>{v.duration_ms} ms</td><td>{v.counted ? 'ya' : 'tidak (toleransi)'}</td><td>{v.penalty}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
        {!isLoading && (rows || []).length === 0 && <Card>Tidak ada pelanggaran tercatat.</Card>}
      </div>
    </div>
  );
}
