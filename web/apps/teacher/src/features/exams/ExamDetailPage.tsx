import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useApiQuery, QueryError } from '@flowcbt/api-client';
import { Button, Card, Badge, Input, useToast, PageHeader, EmptyState, Icon, SkeletonList, Modal } from '@flowcbt/ui';
import { fmtDateTime, statusLabel, statusTone } from '@flowcbt/shared';

// Detail ujian + aksi pengawas (FR-5.6/5.7): token, regenerasi, peserta, extend-time, reset, force-submit, pause/tutup.
export default function ExamDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: exam, isLoading: lExam, error: eExam, refetch } = useApiQuery<any>(['exam-' + id], `/exams/${id}`);
  const { data: participants, isLoading: lP, error: eP, refetch: refP } = useApiQuery<any[]>(['parts-' + id], `/exams/${id}/participants`);
  const { data: attempts, isLoading: lA, error: eA, refetch: refA } = useApiQuery<any>(['att-' + id], `/exams/${id}/attempts`);
  const [extendSec, setExtendSec] = useState(300);
  const [confirmAct, setConfirmAct] = useState<{ path: string; body: any; label: string } | null>(null);

  // A-04/A-06: error dicek lebih dulu; skeleton tidak boleh bertahan saat query gagal.
  if (eExam) return <QueryError error={eExam} onRetry={refetch} />;
  if (lExam || !exam) {
    return (
      <div style={{ display: 'grid', gap: 14 }} aria-busy="true">
        <Card><SkeletonList rows={2} height={30} gap={14} /></Card>
        <Card><SkeletonList rows={3} height={24} gap={14} /></Card>
      </div>
    );
  }

  const runAct = async (path: string, body: any, label: string) => {
    try {
      await api('POST', path, body);
      toast(label, 'ok');
      refetch(); refP(); refA();
    } catch (err: any) { toast(err.message, 'danger'); }
  };
  // A-14: aksi destruktif harus dikonfirmasi dengan menyebut nama objek.
  const act = (path: string, body: any = {}, label: string, dangerous = false) => {
    if (dangerous) setConfirmAct({ path, body, label });
    else void runAct(path, body, label);
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PageHeader
        title={exam.name}
        subtitle={`${fmtDateTime(exam.open_at)} – ${fmtDateTime(exam.close_at)} · ${exam.duration_minutes} menit · status ${statusLabel(exam.status)}`}
        actions={<Link to="/exams"><Button variant="ghost"><Icon name="chevron-left" /> Daftar ujian</Button></Link>}
      />
      {exam.token && (
        <Card>
          <div className="card-title">Akses siswa</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="stat-label">Token</div>
              <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: 4 }}>{exam.token}</div>
            </div>
            {exam.status === 'published' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button variant="ghost" onClick={() => act(`/exams/${id}/token/regenerate`, {}, 'Token baru dibuat')}><Icon name="refresh" /> Regenerasi</Button>
                <Button variant="ghost" onClick={() => act(`/exams/${id}/pause`, {}, 'Ujian dijeda', true)}><Icon name="pause" /> Jeda</Button>
                <Button variant="ghost" onClick={() => act(`/exams/${id}/close`, {}, 'Ujian ditutup', true)}><Icon name="square" /> Tutup</Button>
                <Link to={`/exams/${id}/cheating`}><Button variant="ghost"><Icon name="shield" /> Laporan curang</Button></Link>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <div className="card-title">Peserta & aksi pengawas <span className="count-pill">{(participants || []).length}</span></div>
        {eP ? <QueryError error={eP} onRetry={refP} /> : lP ? <div aria-busy="true"><SkeletonList rows={3} /></div> : <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nama</th><th>Kelas</th><th>Percobaan</th><th>Aksi pengawas</th></tr></thead>
            <tbody>
              {(participants || []).map((p) => (
                <tr key={p.student_id}>
                  <td>{p.name} {p.is_guest && <Badge tone="warn"><Icon name="user" /> tamu</Badge>}</td>
                  <td>{p.class}</td><td>{p.attempts}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Input type="number" aria-label="Detik tambahan" value={extendSec} onChange={(e) => setExtendSec(Number(e.target.value))} style={{ width: 90 }} />
                      <Button variant="ghost" onClick={() => act(`/exams/${id}/participants/${p.student_id}/extend-time`, { seconds: extendSec }, `+${extendSec} detik untuk ${p.name}`)}><Icon name="plus" /> Tambah waktu</Button>
                      <Button variant="ghost" onClick={() => act(`/exams/${id}/participants/${p.student_id}/reset-attempt`, {}, `Attempt ${p.name} direset`, true)}><Icon name="refresh" /> Reset</Button>
                      <Button variant="danger" onClick={() => act(`/exams/${id}/participants/${p.student_id}/force-submit`, {}, `Paksa selesai ${p.name}`, true)}><Icon name="square" /> Paksa selesai</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {(participants || []).length === 0 && <tr><td colSpan={4}><EmptyState icon="users" title="Belum ada peserta">Atur penugasan kelas atau siswa pada wizard pembuatan ujian.</EmptyState></td></tr>}
            </tbody>
          </table>
        </div>}
      </Card>

      <Card>
        <div className="card-title">Rekap nilai</div>
        {eA ? <QueryError error={eA} onRetry={refA} /> : lA ? <div aria-busy="true"><SkeletonList rows={3} /></div> : <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nama</th><th>Percobaan</th><th>Nilai akhir</th><th>Asli</th><th>Penalti</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(attempts?.attempts || []).map((a: any) => (
                <tr key={a.student_id + '-' + a.attempt_no}>
                  <td>{a.name}</td><td>#{a.attempt_no}</td>
                  <td><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{a.final_score ?? '—'}</strong></td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{a.raw_score ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{a.penalty_points ? `-${a.penalty_points}` : '—'}</td>
                  <td><Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge> {a.cheating_status !== 'none' && <Badge tone="danger"><Icon name="shield" /> {a.cheating_status}</Badge>}</td>
                  <td>{a.status === 'awaiting_manual_grading' && <Link to={`/grading/${a.attempt_id}`}><Button variant="ghost">Nilai uraian</Button></Link>}</td>
                </tr>
              ))}
              {(attempts?.attempts || []).length === 0 && <tr><td colSpan={7}><EmptyState icon="doc" title="Belum ada pengerjaan">Rekap nilai muncul setelah siswa mulai mengerjakan.</EmptyState></td></tr>}
            </tbody>
          </table>
        </div>}
      </Card>

      {confirmAct && (
        <Modal open={!!confirmAct} onClose={() => setConfirmAct(null)} title="Konfirmasi aksi">
          <p>{confirmAct.label}. Aksi ini tidak bisa dibatalkan.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setConfirmAct(null)}>Batal</Button>
            <Button variant="danger" onClick={() => { const a = confirmAct; setConfirmAct(null); void runAct(a.path, a.body, a.label); }}>Ya, lanjutkan</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
