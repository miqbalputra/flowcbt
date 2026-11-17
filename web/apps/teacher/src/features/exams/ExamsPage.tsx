import React from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery, QueryError, QueryGate } from '@flowcbt/api-client';
import { Button, Card, Badge, SkeletonList, PageHeader, EmptyState, Icon } from '@flowcbt/ui';
import { fmtDateTime, statusLabel, statusTone } from '@flowcbt/shared';

export default function ExamsPage() {
  const { data: exams, refetch, error, isLoading } = useApiQuery<any[]>(['exams'], '/exams');
  return (
    <div>
      <PageHeader
        title="Ujian"
        subtitle="Jadwalkan paket soal menjadi sesi ujian."
        actions={<Link to="/exams/new"><Button><Icon name="plus" /> Ujian Baru</Button></Link>}
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {error && <QueryError error={error} onRetry={refetch} />}
        <QueryGate query={{ isLoading, error: null }} skeleton={<SkeletonList rows={4} />}>
          {(exams || []).map((e) => (
          <Card key={e.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div>
                <Link to={`/exams/${e.id}`}><strong>{e.name}</strong></Link> <Badge>{e.question_set_title}</Badge>{' '}
                <Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {fmtDateTime(e.open_at)} – {fmtDateTime(e.close_at)} · {e.duration_minutes} menit
                  {e.token && <> · token <strong>{e.token}</strong></>}
                </div>
              </div>
              {e.status === 'published' && <Link to={`/exams/${e.id}/cheating`}><Button variant="ghost">Laporan curang</Button></Link>}
            </div>
          </Card>
        ))}
        </QueryGate>
        {!error && !isLoading && (exams || []).length === 0 && <Card><EmptyState icon="exams" title="Belum ada ujian">Pilih paket soal yang sudah dipublish, lalu atur jadwalnya.</EmptyState></Card>}
      </div>
    </div>
  );
}
