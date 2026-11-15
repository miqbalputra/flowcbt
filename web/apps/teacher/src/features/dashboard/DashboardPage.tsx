import React from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, Badge, Button, SkeletonCards } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Dashboard guru/admin (FR-2.1/2.2).
export default function DashboardPage() {
  const { data: exams, isLoading: lExams } = useApiQuery<any[]>(['exams'], '/exams');
  const { data: students, isLoading: lStudents } = useApiQuery<any[]>(['students'], '/students');
  const { data: sets, isLoading: lSets } = useApiQuery<any[]>(['qs'], '/question-sets');
  const { data: sub, isLoading: lSub } = useApiQuery<any>(['sub'], '/billing/subscription');
  const { data: live, isLoading: lLive } = useApiQuery<any[]>(['live'], '/reports/live');
  const running = (live || []);
  const lastExam = (exams || []).filter((e) => e.status !== 'draft')[0];
  const loadingAny = lExams || lStudents || lSets;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {loadingAny ? (
        <SkeletonCards count={4} />
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Card><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Ujian berjalan</div><strong style={{ fontSize: 26 }}>{running.length}</strong></Card>
        <Card><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Total ujian</div><strong style={{ fontSize: 26 }}>{(exams || []).length}</strong></Card>
        <Card><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Siswa aktif</div><strong style={{ fontSize: 26 }}>{(students || []).length}<span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/{sub?.student_limit ?? 10}</span></strong></Card>
        <Card><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Paket soal</div><strong style={{ fontSize: 26 }}>{(sets || []).length}</strong></Card>
      </div>
      )}

      <Card>
        <strong>Status langganan</strong>{' '}
        {lSub ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }} aria-busy="true">memuat status…</span>
        ) : (<>
        {sub?.monthly_active && <Badge tone="ok">Bulanan aktif s/d {fmtDateTime(sub.monthly_ends_at)}</Badge>}
        {sub?.trial_active && <Badge tone="brand">Trial — sisa {sub.trial_exams_left} ujian</Badge>}
        {sub?.credits_left > 0 && <Badge tone="ok">Kredit ujian: {sub.credits_left}</Badge>}
        {!sub?.has_active_quota && <Badge tone="danger">Kuota habis — <Link to="/billing">upgrade</Link></Badge>}
        {sub?.read_only && <Badge tone="danger">Mode baca-saja (retensi)</Badge>}
        </>)}
      </Card>

      <Card>
        <strong>Pintasan cepat (FR-2.2)</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <Link to="/question-sets"><Button>Buat Soal</Button></Link>
          <Link to="/exams/new"><Button>Buat Ujian</Button></Link>
          <Link to="/students"><Button>Import Siswa</Button></Link>
          <Link to="/reports/history"><Button>Lihat Laporan</Button></Link>
        </div>
      </Card>

      {lLive ? (
        <Card aria-busy="true">
          <strong>Ujian berjalan saat ini</strong>
          <div style={{ marginTop: 8 }}><span className="skeleton" style={{ width: '60%' }} /></div>
        </Card>
      ) : running.length > 0 && (
        <Card>
          <strong>Ujian berjalan saat ini</strong>
          {running.map((e) => (
            <div key={e.exam_id} style={{ marginTop: 6 }}>
              <Link to={`/reports/live`}>{e.name}</Link> — {e.subject} · selesai {fmtDateTime(e.close_at)} · {e.in_progress} mengerjakan / {e.total} peserta
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
