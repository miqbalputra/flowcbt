import React from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, Badge, Button, SkeletonCards, Icon, PageHeader, StatCard, EmptyState } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Dashboard guru/admin (FR-2.1/2.2).
export default function DashboardPage() {
  const { data: exams, isLoading: lExams } = useApiQuery<any[]>(['exams'], '/exams');
  const { data: students, isLoading: lStudents } = useApiQuery<any[]>(['students'], '/students');
  const { data: sets, isLoading: lSets } = useApiQuery<any[]>(['qs'], '/question-sets');
  const { data: sub, isLoading: lSub } = useApiQuery<any>(['sub'], '/billing/subscription');
  const { data: live, isLoading: lLive } = useApiQuery<any[]>(['live'], '/reports/live');
  const running = (live || []);
  const loadingAny = lExams || lStudents || lSets;

  const shortcuts = [
    { to: '/question-sets', icon: 'bank', label: 'Buat Soal' },
    { to: '/exams/new', icon: 'exams', label: 'Buat Ujian' },
    { to: '/students', icon: 'upload', label: 'Import Siswa' },
    { to: '/reports/history', icon: 'report', label: 'Lihat Laporan' },
  ] as const;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Dashboard"
        subtitle={sub?.read_only ? 'Akun dalam mode baca-saja.' : 'Ringkasan aktivitas sekolah Anda hari ini.'}
        actions={running.length > 0 && <Link to="/reports/live"><Button><Icon name="report" /> Pantau Ujian Live</Button></Link>}
      />

      {loadingAny ? (
        <SkeletonCards count={4} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <StatCard label="Ujian sedang berjalan" value={running.length}
            hint={running.length > 0 ? 'klik Pantau Live di atas' : undefined} />
          <StatCard label="Total ujian" value={(exams || []).length} />
          <StatCard label="Siswa aktif" value={(students || []).length}
            hint={`batas paket: ${sub?.student_limit ?? '—'} siswa`} />
          <StatCard label="Paket soal" value={(sets || []).length} />
        </div>
      )}

      <Card>
        <div className="card-title" style={{ marginBottom: 12 }}>Status langganan</div>
        {lSub ? (
          <span className="card-sub" aria-busy="true">Memuat status…</span>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {sub?.monthly_active && <Badge tone="ok"><Icon name="check" size={12} />Bulanan aktif s/d {fmtDateTime(sub.monthly_ends_at)}</Badge>}
            {sub?.trial_active && <Badge tone="brand"><Icon name="clock" size={12} />Trial — sisa {sub.trial_exams_left} ujian</Badge>}
            {sub?.credits_left > 0 && <Badge tone="ok"><Icon name="check" size={12} />Kredit ujian: {sub.credits_left}</Badge>}
            {!sub?.has_active_quota && <Badge tone="danger"><Icon name="alert" size={12} />Kuota habis — <Link to="/billing" style={{ color: 'inherit', textDecoration: 'underline' }}>upgrade</Link></Badge>}
            {sub?.read_only && <Badge tone="danger"><Icon name="alert" size={12} />Mode baca-saja (masa retensi)</Badge>}
          </div>
        )}
      </Card>

      <div>
        <div className="card-title" style={{ marginBottom: 10 }}>Mulai cepat</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          {shortcuts.map((s) => (
            <Link key={s.to} to={s.to} className="quick-link">
              <Icon name={s.icon} />
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {lLive ? (
        <Card aria-busy="true">
          <div className="card-title">Ujian berjalan saat ini</div>
          <div style={{ marginTop: 10 }}><span className="skeleton" style={{ width: '60%' }} /></div>
        </Card>
      ) : running.length > 0 && (
        <Card>
          <div className="card-title" style={{ marginBottom: 8 }}>Ujian berjalan saat ini</div>
          {running.map((e) => (
            <div key={e.exam_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--muted)' }}>
              <span style={{
                width: 9, height: 9, borderRadius: 999, background: 'var(--ok)', flexShrink: 0,
                boxShadow: '0 0 0 3px var(--ok-bg)',
              }} aria-label="berjalan" />
              <Link to="/reports/live" style={{ fontWeight: 600 }}>{e.name}</Link>
              <span className="card-sub">
                {e.in_progress} dari {e.total} peserta mengerjakan · tutup {fmtDateTime(e.close_at)}
              </span>
            </div>
          ))}
        </Card>
      )}

      {!lLive && running.length === 0 && !lExams && (exams || []).length === 0 && (
        <Card><EmptyState icon="play" title="Belum ada ujian">Buat paket soal pertama Anda, lalu jadwalkan ujian.</EmptyState></Card>
      )}
    </div>
  );
}
