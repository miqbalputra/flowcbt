import React from 'react';
import { Link } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Badge, SkeletonList, PageHeader, EmptyState, Icon } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Riwayat ujian & nilai siswa (FR-6.6).
export default function HistoryPage() {
  const { data: exams, isLoading } = useApiQuery<any[]>(['my-exams'], '/me/exams');
  const done = (exams || []).filter((e) => e.state === 'closed' || e.last_score != null);
  return (
    <div className="app-wrap">
      <PageHeader
        title="Riwayat & Nilai"
        subtitle="Seluruh ujian yang pernah Anda ikuti."
        actions={<Link to="/exams"><Button variant="ghost"><Icon name="chevron-left" /> Ujian</Button></Link>}
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {isLoading && <SkeletonList rows={3} height={28} gap={14} />}
        {!isLoading && done.map((e) => (
          <Card key={e.exam_id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="st-exam-badge" aria-hidden="true"><Icon name="trophy" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{e.name}</strong> <Badge tone="muted">{e.subject}</Badge>
              <div className="card-sub">{fmtDateTime(e.close_at)} · percobaan: {e.attempts_used}{e.max_attempts ? `/${e.max_attempts}` : ''}</div>
            </div>
            {e.last_score != null && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="stat-label">Nilai</div>
                <div style={{ fontSize: 22, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{e.last_score}</div>
              </div>
            )}
          </Card>
        ))}
        {!isLoading && done.length === 0 && <Card><EmptyState icon="trophy" title="Belum ada riwayat">Selesaikan ujian pertama Anda, nilainya muncul di sini.</EmptyState></Card>}
      </div>
    </div>
  );
}
