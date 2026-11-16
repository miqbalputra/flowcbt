import React from 'react';
import { useParams } from 'react-router-dom';
import { useApiQuery, apiDownload, QueryError } from '@flowcbt/api-client';
import { Card, Badge, Button, SkeletonCards, SkeletonTableRows, useToast } from '@flowcbt/ui';

// Detail laporan ujian (FR-9.8/9.9): statistik + histogram + analisis butir + export.
export default function ExamReportPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: rep, error: errRep, refetch: refetchRep, isLoading: lRep } = useApiQuery<any>(['rep-' + id], `/reports/exams/${id}`);
  const { data: items, isLoading: lItems } = useApiQuery<any[]>(['items-' + id], `/reports/exams/${id}/item-analysis`);
  const { data: attempts, isLoading: lAtt } = useApiQuery<any>(['rep-att-' + id], `/reports/exams/${id}/attempts`);

  if (errRep) return <div style={{ padding: 16 }}><QueryError error={errRep} onRetry={refetchRep} /></div>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {lRep ? <SkeletonCards count={1} /> : (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{rep?.name}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{rep?.subject} · KKM {rep?.passing_score ?? '-'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => apiDownload(`/reports/exams/${id}/export?format=xlsx`, 'rekap-ujian.xlsx').catch((e) => toast(e.message, 'danger'))}>Export xlsx</Button>
            <Button variant="ghost" onClick={() => apiDownload(`/reports/exams/${id}/export?format=csv`, 'rekap-ujian.csv').catch((e) => toast(e.message, 'danger'))}>Export csv</Button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <Badge tone="brand">Peserta: {rep?.count ?? 0}</Badge>
          <Badge tone="ok">Rata-rata: {rep?.avg != null ? Number(rep.avg).toFixed(2) : '-'}</Badge>
          <Badge>Median: {rep?.median != null ? Number(rep.median).toFixed(2) : '-'}</Badge>
          <Badge>Maks: {rep?.max ?? '-'} · Min: {rep?.min ?? '-'}</Badge>
          <Badge tone="ok">Lulus: {rep?.passed ?? 0} ({rep?.pass_rate ?? '-'})</Badge>
        </div>
        {rep?.histogram && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', marginTop: 12, height: 80 }}>
            {Object.entries(rep.histogram as Record<string, number>).map(([range, c]) => (
              <div key={range} title={`${range}: ${c}`} style={{ flex: 1, height: `${Math.max(4, (c as number) * 20)}px`, background: 'var(--brand-500)', borderRadius: '4px 4px 0 0' }} />
            ))}
          </div>
        )}
      </Card>
      )}

      <Card>
        <strong>Analisis butir soal (FR-9.9)</strong>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>#</th><th>Tipe</th><th>Poin</th><th>Terjawab</th><th>Benar</th><th>% benar</th></tr></thead>
          {lItems
            ? <SkeletonTableRows cols={6} rows={5} />
            : (
            <tbody>
            {(items || []).map((it) => (
              <tr key={it.question_id}>
                <td>{it.order_no}</td><td>{it.type}</td><td>{it.points}</td><td>{it.answered}</td><td>{it.correct}</td>
                <td><Badge tone={Number(it.pct_correct) >= 70 ? 'ok' : Number(it.pct_correct) >= 40 ? 'warn' : 'danger'}>{it.pct_correct}%</Badge></td>
              </tr>
            ))}
            </tbody>
            )}
        </table>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Nama</th><th>Kelas</th><th>Percobaan</th><th>Nilai akhir</th><th>Penalti</th><th>Status</th><th>Durasi</th></tr></thead>
          {lAtt
            ? <SkeletonTableRows cols={7} rows={5} />
            : (
            <tbody>
            {(attempts?.attempts || []).map((a: any, i: number) => (
              <tr key={i}>
                <td>{a.name}</td><td>{a.class}</td><td>#{a.attempt_no}</td>
                <td><strong>{a.final_score ?? '-'}</strong></td><td>{a.penalty_points || 0}</td>
                <td><Badge tone={a.status === 'graded' ? 'ok' : 'muted'}>{a.status}</Badge></td><td>{a.duration_s != null ? `${a.duration_s} dtk` : '-'}</td>
              </tr>
            ))}
            </tbody>
            )}
        </table>
      </Card>
    </div>
  );
}
