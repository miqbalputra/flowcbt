import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Input, Card, useToast, Badge } from '@flowcbt/ui';
import { db } from '../offline/db';

// Alur mulai ujian (FR-6.2): token → tata tertib → mulai; paket soal di-cache ke IndexedDB (FR-7.2).
export default function StartPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: exams } = useApiQuery<any[]>(['my-exams'], '/me/exams');
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
    <div style={{ maxWidth: 560, margin: '6vh auto', padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>{exam?.name || 'Mulai Ujian'}</h1>
      <Card>
        <label>Token ujian
          <Input value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} placeholder="6 karakter" maxLength={12} />
        </label>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--muted)', fontSize: 14 }}>
          <strong>Tata tertib:</strong>
          <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
            <li>Satu sesi aktif; jangan pindah aplikasi/tab (tercatat sebagai pelanggaran{exam ? '' : ''}).</li>
            <li>Jika koneksi putus, Anda tetap bisa mengerjakan; jawaban tersimpan lokal dan tersinkron otomatis saat online.</li>
            <li>Jangan menutup/menghapus data browser sebelum status "Tersinkron".</li>
            <li>Waktu dihitung dari server saat Anda menekan Mulai.</li>
          </ul>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            Saya menyetujui tata tertib
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={start} disabled={busy || !token || !agreed}>
            {busy ? 'Mengunduh soal…' : 'Mulai'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
