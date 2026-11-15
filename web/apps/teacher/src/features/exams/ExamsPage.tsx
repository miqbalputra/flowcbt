import React from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery, QueryError } from '@flowcbt/api-client';
import { Button, Card, Badge } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

export default function ExamsPage() {
  const { data: exams, refetch, error } = useApiQuery<any[]>(['exams'], '/exams');
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>Ujian</h1>
        <Link to="/exams/new"><Button>+ Ujian baru</Button></Link>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {(exams || []).map((e) => (
          <Card key={e.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div>
                <Link to={`/exams/${e.id}`}><strong>{e.name}</strong></Link> <Badge>{e.question_set_title}</Badge>{' '}
                <Badge tone={e.status === 'published' ? 'ok' : e.status === 'draft' ? 'muted' : 'warn'}>{e.status}</Badge>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {fmtDateTime(e.open_at)} – {fmtDateTime(e.close_at)} · {e.duration_minutes} menit
                  {e.token && <> · token <strong>{e.token}</strong></>}
                </div>
              </div>
              {e.status === 'published' && <Link to={`/exams/${e.id}/cheating`}><Button variant="ghost">Laporan curang</Button></Link>}
            </div>
          </Card>
        ))}
        {!error && (exams || []).length === 0 && <Card>Belum ada ujian. <Link to="/exams/new">Buat sekarang</Link>.</Card>}
      </div>
    </div>
  );
}
