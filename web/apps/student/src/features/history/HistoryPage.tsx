import React from 'react';
import { Link } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Badge } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Riwayat ujian & nilai siswa (FR-6.6).
export default function HistoryPage() {
  const { data: exams } = useApiQuery<any[]>(['my-exams'], '/me/exams');
  const done = (exams || []).filter((e) => e.state === 'closed' || e.last_score != null);
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>Riwayat & Nilai</h1>
        <Link to="/exams"><Button variant="ghost">← Ujian</Button></Link>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {done.map((e) => (
          <Card key={e.exam_id}>
            <strong>{e.name}</strong> <Badge>{e.subject}</Badge>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDateTime(e.close_at)} · percobaan terpakai: {e.attempts_used}{e.max_attempts ? `/${e.max_attempts}` : ''}</div>
            {e.last_score != null && <div style={{ marginTop: 4 }}>Nilai: <strong>{e.last_score}</strong></div>}
          </Card>
        ))}
        {done.length === 0 && <Card>Belum ada riwayat.</Card>}
      </div>
    </div>
  );
}
