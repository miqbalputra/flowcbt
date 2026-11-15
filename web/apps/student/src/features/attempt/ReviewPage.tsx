import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@flowcbt/api-client';
import { Button, Card, Badge } from '@flowcbt/ui';
import { db } from '../offline/db';

// Konfirmasi selesai (FR-6.5): ringkasan terjawab/belum/ragu; submit (online → langsung, offline → pending_sync lalu auto saat online, AC-4).
export default function ReviewPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [summary, setSummary] = useState<{ answered: number; flagged: number; total: number } | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const att = await db.attempts.get(id!);
      const outbox = await db.outbox.where('attemptId').equals(id!).toArray();
      const ans = new Set(outbox.filter((e) => e.type === 'answer').map((e) => e.question_id));
      setSummary({ answered: ans.size, flagged: outbox.filter((e) => e.type === 'flag' && (e.payload as any)?.flagged).length, total: att?.packet.questions.length || 0 });
      setPending(outbox.length);
    })();
  }, [id]);

  const confirm = async () => {
    setBusy(true);
    try {
      // kirim semua event tersisa + flag submitted (idempoten via client_event_id)
      const events = await db.outbox.where('attemptId').equals(id!).toArray();
      if (navigator.onLine) {
        await api('POST', `/attempts/${id}/answers:sync`, { events, submitted: true, submit_reason: 'manual' });
      }
      await db.attempts.update(id!, { status: 'pending_sync', submittedLocal: true });
      nav(`/attempt/${id}/done`);
    } catch (err: any) {
      // offline: tetap lanjut, akan tersinkron otomatis saat online (AC-4)
      await db.attempts.update(id!, { status: 'pending_sync', submittedLocal: true });
      nav(`/attempt/${id}/done`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: '6vh auto', padding: 16 }}>
      <h1 style={{ fontSize: 22 }}>Konfirmasi Selesai</h1>
      <Card>
        {summary && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <Badge tone="ok">Terjawab: {summary.answered}/{summary.total}</Badge>
            <Badge tone="muted">Belum: {summary.total - summary.answered}</Badge>
            <Badge tone="warn">Ragu-ragu: {summary.flagged}</Badge>
          </div>
        )}
        {summary && summary.answered < summary.total && (
          <p style={{ color: 'var(--warn)' }}>Masih ada {summary.total - summary.answered} soal belum dijawab.</p>
        )}
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>
          {navigator.onLine
            ? 'Saat ini online — jawaban akan langsung terkirim ke server.'
            : 'Saat ini offline — jawaban tersimpan di perangkat dan otomatis terkirim saat koneksi pulih (jangan hapus data browser).'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => nav(`/attempt/${id}`)}>Kembali</Button>
          <Button onClick={confirm} disabled={busy}>{busy ? 'Mengirim…' : 'Ya, selesai & kirim'}</Button>
        </div>
      </Card>
    </div>
  );
}
