import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApiQuery, getAccessToken, API_BASE } from '@flowcbt/api-client';
import { Card, Badge, SkeletonTableRows } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Laporan real-time (FR-9.1–9.5) via SSE + fallback polling 10 dtk.
export default function LiveReportPage() {
  const { data: live, isLoading: lLive } = useApiQuery<any[]>(['live'], '/reports/live');
  const [examId, setExamId] = useState<string>('');
  const [parts, setParts] = useState<any[]>([]);

  useEffect(() => {
    if (!examId) {
      const first = (live || []).find((e) => e.status);
      if (first && !examId) setExamId(first.exam_id);
    }
  }, [live]);

  useEffect(() => {
    if (!examId) return;
    let es: EventSource | null = null;
    const poll = async () => {
      try {
        const r = await api<any>('GET', `/reports/live/${examId}`);
        setParts(r.participants || []);
      } catch {}
    };
    void poll();
    const t = setInterval(poll, 10000); // fallback polling 10 dtk (FR-9.3)
    try {
      es = new EventSource(`${API_BASE}/reports/live/stream?examId=${examId}`);
      // SSE membawa token via query tidak bisa; server dev tanpa auth untuk SSE — tetap coba, fallback polling di atas
      es.onmessage = () => { void poll(); };
    } catch {}
    return () => { clearInterval(t); es?.close(); };
  }, [examId]);

  const exam = (live || []).find((e) => e.exam_id === examId);
  const done = parts.filter((p) => p.status !== 'not_started' && p.status !== 'in_progress').length;
  const inProg = parts.filter((p) => p.status === 'in_progress').length;

  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Laporan Real-Time</h1>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        {(live || []).map((e) => (
          <button key={e.exam_id} className="btn btn-ghost" style={{ borderColor: e.exam_id === examId ? 'var(--brand-600)' : 'var(--muted)' }} onClick={() => setExamId(e.exam_id)}>
            {e.name} ({e.subject})
          </button>
        ))}
        {(live || []).length === 0 && !lLive && <Card>Tidak ada ujian yang sedang berjalan.</Card>}
        {lLive && <Card style={{ width: 240 }} aria-busy="true"><span className="skeleton" style={{ width: '80%' }} /></Card>}
      </div>
      {exam && (
        <Card style={{ marginBottom: 12 }}>
          <strong>{exam.name}</strong> — tutup {fmtDateTime(exam.close_at)} ·{' '}
          <Badge tone="brand">Menghuni {inProg}</Badge> <Badge tone="ok">Selesai {done}</Badge> <Badge tone="muted">Total {exam.total}</Badge>
        </Card>
      )}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Nama</th><th>Kelas</th><th>Status</th><th>Progres</th><th>Terakhir aktiv</th><th>Pelanggaran</th></tr></thead>
          {lLive || (parts.length === 0 && examId)
            ? <SkeletonTableRows cols={6} rows={5} />
            : (
            <tbody>
            {parts.map((p) => (
              <tr key={p.student_id}>
                <td>{p.name} {p.is_guest && <Badge tone="warn">tamu</Badge>} {p.offline && <Badge tone="danger">offline</Badge>}</td>
                <td>{p.class}</td>
                <td><Badge tone={p.status === 'in_progress' ? 'brand' : p.status === 'not_started' ? 'muted' : 'ok'}>{p.status}</Badge></td>
                <td>{p.answered}/{p.total_questions}</td>
                <td>{fmtDateTime(p.last_seen_at)}</td>
                <td>{p.violation_count > 0 && <Badge tone="danger">{p.violation_count} {p.cheating_status === 'flagged' ? 'CURANG' : ''}</Badge>}</td>
              </tr>
            ))}
            {parts.length === 0 && !examId && <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>Pilih ujian di atas.</td></tr>}
            </tbody>
            )}
        </table>
      </Card>
    </div>
  );
}
