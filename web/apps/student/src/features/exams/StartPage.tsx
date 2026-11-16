import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, Badge, Icon } from '@flowcbt/ui';
import { db } from '../offline/db';

// Alur mulai ujian (FR-6.2): token → tata tertib → mulai; paket soal di-cache ke IndexedDB (FR-7.2).
export default function StartPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: exams, isLoading: lExams } = useApiQuery<any[]>(['my-exams'], '/me/exams');
  const exam = (exams || []).find((e) => e.exam_id === id);

  const start = async () => {
    setBusy(true);
    try {
      const packet = await api<any>('POST', `/exams/${id}/start`, { token: token.toUpperCase() });
      // simpan paket soal ke IndexedDB sebelum mulai (FR-7.2) — ujian baru jalan setelah tersimpan penuh
      const startedPerf = performance.now();
      await db.attempts.put({
        attemptId: packet.attempt_id,
        examId: id!,
        packet,
        startedPerf,
        serverNowIso: packet.server_now,
        deadlineIso: packet.deadline_at,
        submittedLocal: false,
        status: 'in_progress',
      });
      await db.questions.bulkPut(packet.questions.map((q: any) => ({ attemptId: packet.attempt_id, question: q })));
      toast('Ujian dimulai. Soal sudah tersimpan di perangkat.', 'ok');
      nav(`/attempt/${packet.attempt_id}`);
    } catch (err: any) {
      toast(err.message || 'Gagal memulai ujian', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-wrap">
      <div style={{ textAlign: 'center', margin: '22vh 0 14px' }}>
        <Badge tone="brand"><Icon name="calendar" size={12} />Ujian</Badge>
        <h1 style={{ fontSize: 22, marginTop: 8 }}>{exam?.name || (lExams ? 'Memuat ujian…' : 'Mulai Ujian')}</h1>
      </div>
      <Card aria-busy={lExams || undefined}>
        <label className="field">
          <span style={{ textAlign: 'center' }}>Masukkan token dari pengawas</span>
          <Input value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} placeholder="6 HURUF" maxLength={12}
            style={{ letterSpacing: '0.25em', fontWeight: 650, textAlign: 'center', fontSize: 18, minHeight: 52 }} />
        </label>
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: 'var(--surface-3)', fontSize: 14 }}>
          <strong>Tata tertib ujian:</strong>
          <ul style={{ margin: '8px 0', paddingLeft: 20, display: 'grid', gap: 5, color: 'var(--text-muted)' }}>
            <li>Kerjakan sendiri; jangan berpindah aplikasi atau tab — tercatat sebagai pelanggaran.</li>
            <li>Jika koneksi terputus, jawaban tetap tersimpan dan akan terkirim otomatis saat online kembali.</li>
            <li>Jangan menutup/menghapus data browser sebelum status "Terkirim".</li>
            <li>Waktu dihitung dari server saat Anda menekan Mulai.</li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>Saya membaca dan menyetujui tata tertib di atas</span>
          </label>
        </div>
        <div style={{ marginTop: 16 }}>
          <Button style={{ width: '100%' }} onClick={start} disabled={busy || lExams || !exam || !token || !agreed}>
            <Icon name={busy ? 'clock' : 'play'} />
            {busy ? 'Mengunduh soal…' : 'Mulai Ujian'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
