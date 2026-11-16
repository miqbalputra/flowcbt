import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiQuery, logout as logoutAll, QueryError } from '@flowcbt/api-client';
import { Badge, Button, Card, ThemeToggle, SkeletonList, EmptyState, Icon, Logo } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Dashboard siswa (FR-6.1): sedang dibuka / akan datang / selesai.
export default function ExamsPage() {
  const nav = useNavigate();
  const { data: exams, isLoading, error, refetch } = useApiQuery<any[]>(['my-exams'], '/me/exams');
  const logout = () => { void logoutAll().finally(() => nav('/login')); };

  const groups: { key: string; label: string }[] = [
    { key: 'open', label: 'Sedang dibuka' },
    { key: 'upcoming', label: 'Akan datang' },
    { key: 'closed', label: 'Selesai' },
  ];
  const byState = (s: string) => (exams || []).filter((e) => e.state === s);

  return (
    <div className="app-wrap">
      <div className="st-head">
        <Logo size={22} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link to="/history"><Button variant="ghost" className="btn-sm">Riwayat</Button></Link>
          <ThemeToggle />
          <Button variant="ghost" className="btn-sm" onClick={logout} aria-label="Keluar"><Icon name="logout" /></Button>
        </div>
      </div>

      <h1 style={{ fontSize: 22, margin: '18px 0 16px' }}>Ujian Saya</h1>

      {isLoading && <SkeletonList rows={4} height={28} gap={14} />}
      {error && <QueryError error={error} onRetry={refetch} />}

      <div style={{ display: 'grid', gap: 22 }}>
        {groups.map((g) => {
          const rows = byState(g.key);
          if (rows.length === 0) return null;
          return (
            <section key={g.key}>
              <h2 className="st-group-title">{g.label}</h2>
              <div style={{ display: 'grid', gap: 10 }}>
                {rows.map((e) => (
                  <Card key={e.exam_id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span className="st-exam-badge" aria-hidden="true">
                      <Icon name="exams" />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong>{e.name}</strong>
                        <Badge tone="muted">{e.subject}</Badge>
                      </div>
                      <div className="card-sub">
                        {fmtDateTime(e.open_at)} – {fmtDateTime(e.close_at)} · {e.duration_minutes} menit · kode {e.exam_code}
                      </div>
                    </div>
                    {e.state === 'open' && (
                      e.active_attempt_id
                        ? <Link to={`/attempt/${e.active_attempt_id}`}><Button>Lanjutkan</Button></Link>
                        : <Link to={`/exams/${e.exam_id}/start`}><Button><Icon name="play" /> Mulai</Button></Link>
                    )}
                    {e.state === 'upcoming' && <Badge tone="muted">Akan datang</Badge>}
                    {e.state === 'closed' && <Badge tone="muted">Selesai</Badge>}
                  </Card>
                ))}
              </div>
            </section>
          );
        })}

        {!isLoading && !error && (exams || []).length === 0 && (
          <Card><EmptyState icon="exams" title="Belum ada ujian untuk Anda">Ujian akan muncul di sini setelah guru menugaskan Anda.</EmptyState></Card>
        )}
      </div>
    </div>
  );
}
