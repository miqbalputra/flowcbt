import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApiQuery, setAccessToken } from '@flowcbt/api-client';
import { Badge, Button, Card, ThemeToggle, Spinner } from '@flowcbt/ui';
import { fmtDateTime, fmtDuration } from '@flowcbt/shared';

// Dashboard siswa (FR-6.1): sedang dibuka / akan datang / selesai.
export default function ExamsPage() {
  const nav = useNavigate();
  const { data: exams, isLoading } = useApiQuery<any[]>(['my-exams'], '/me/exams');
  const logout = () => { setAccessToken(null); localStorage.removeItem('flowcbt-refresh'); nav('/login'); };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Ujian Saya</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/history"><Button variant="ghost">Riwayat</Button></Link>
          <ThemeToggle />
          <Button variant="ghost" onClick={logout}>Keluar</Button>
        </div>
      </div>
      {isLoading && <Spinner />}
      <div style={{ display: 'grid', gap: 12 }}>
        {(exams || []).map((e) => (
          <Card key={e.exam_id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{e.name}</strong> <Badge>{e.subject}</Badge>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {fmtDateTime(e.open_at)} – {fmtDateTime(e.close_at)} · durasi {e.duration_minutes} menit · kode {e.exam_code}
                </div>
              </div>
              {e.state === 'open' && (
                e.active_attempt_id
                  ? <Link to={`/attempt/${e.active_attempt_id}`}><Button>Lanjutkan</Button></Link>
                  : <Link to={`/exams/${e.exam_id}/start`}><Button>Mulai</Button></Link>
              )}
              {e.state === 'upcoming' && <Badge tone="muted">Akan datang</Badge>}
              {e.state === 'closed' && <Badge tone="muted">Selesai</Badge>}
            </div>
            {e.last_score != null && <div style={{ marginTop: 6 }}>Nilai terakhir: <strong>{e.last_score}</strong></div>}
          </Card>
        ))}
        {!isLoading && (exams || []).length === 0 && <Card>Belum ada ujian untuk Anda.</Card>}
      </div>
    </div>
  );
}
