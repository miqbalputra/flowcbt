import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Badge, Input, useToast } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Detail ujian + aksi pengawas (FR-5.6/5.7): token, regenerasi, peserta, extend-time, reset, force-submit, pause/tutup.
export default function ExamDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: exam, refetch } = useApiQuery<any>(['exam-' + id], `/exams/${id}`);
  const { data: participants, refetch: refP } = useApiQuery<any[]>(['parts-' + id], `/exams/${id}/participants`);
  const { data: attempts, refetch: refA } = useApiQuery<any>(['att-' + id], `/exams/${id}/attempts`);
  const [extendSec, setExtendSec] = useState(300);

  if (!exam) return <Card>Memuat…</Card>;

  const act = async (path: string, body: any = {}, label: string) => {
    try {
      await api('POST', path, body);
      toast(label, 'ok');
      refetch(); refP(); refA();
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{exam.name}</h1>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {fmtDateTime(exam.open_at)} – {fmtDateTime(exam.close_at)} · {exam.duration_minutes} menit · <Badge>{exam.status}</Badge>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {exam.status === 'published' && (
              <>
                <Button variant="ghost" onClick={() => act(`/exams/${id}/token/regenerate`, {}, 'Token baru dibuat')}>Regenerasi token</Button>
                <Button variant="ghost" onClick={() => act(`/exams/${id}/pause`, {}, 'Ujian dijeda')}>Jeda</Button>
                <Button variant="ghost" onClick={() => act(`/exams/${id}/close`, {}, 'Ujian ditutup')}>Tutup</Button>
                <Link to={`/exams/${id}/cheating`}><Button variant="ghost">Laporan curang</Button></Link>
              </>
            )}
          </div>
        </div>
        {exam.token && (
          <div style={{ marginTop: 10, padding: 12, background: 'var(--muted)', borderRadius: 10, fontSize: 18 }}>
            Kode ujian: <strong>{exam.question_set_title ? '' : ''}</strong> Token: <strong style={{ letterSpacing: 4 }}>{exam.token}</strong>
          </div>
        )}
      </Card>

      <Card>
        <strong>Peserta ({(participants || []).length}) & aksi pengawas</strong>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>Nama</th><th>Kelas</th><th>Percobaan</th><th style={{ minWidth: 260 }}>Aksi</th></tr></thead>
          <tbody>
            {(participants || []).map((p) => (
              <tr key={p.student_id}>
                <td>{p.name} {p.is_guest && <Badge tone="warn">tamu</Badge>}</td>
                <td>{p.class}</td><td>{p.attempts}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Input type="number" value={extendSec} onChange={(e) => setExtendSec(Number(e.target.value))} style={{ width: 90 }} />
                    <Button variant="ghost" onClick={() => act(`/exams/${id}/participants/${p.student_id}/extend-time`, { seconds: extendSec }, `+${extendSec} detik untuk ${p.name}`)}>Tambah waktu</Button>
                    <Button variant="ghost" onClick={() => act(`/exams/${id}/participants/${p.student_id}/reset-attempt`, {}, 'Attempt direset')}>Reset</Button>
                    <Button variant="danger" onClick={() => act(`/exams/${id}/participants/${p.student_id}/force-submit`, {}, 'Force submit')}>Paksa selesai</Button>
                  </div>
                </td>
              </tr>
            ))}
            {(participants || []).length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Belum ada peserta (atur penugasan saat membuat ujian).</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card>
        <strong>Rekap nilai (FR-3.6)</strong>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>Nama</th><th>Percobaan</th><th>Nilai akhir</th><th>Asli</th><th>Penalti</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(attempts?.attempts || []).map((a: any) => (
              <tr key={a.student_id + '-' + a.attempt_no}>
                <td>{a.name}</td><td>#{a.attempt_no}</td>
                <td><strong>{a.final_score ?? '-'}</strong></td><td>{a.raw_score ?? '-'}</td><td>{a.penalty_points || 0}</td>
                <td><Badge tone={a.status === 'graded' ? 'ok' : 'muted'}>{a.status}</Badge> {a.cheating_status !== 'none' && <Badge tone="danger">{a.cheating_status}</Badge>}</td>
                <td>{a.status === 'awaiting_manual_grading' && <Link to={`/grading/${a.attempt_id}`}>Nilai →</Link>}</td>
              </tr>
            ))}
            {(attempts?.attempts || []).length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>Belum ada yang mengerjakan.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
