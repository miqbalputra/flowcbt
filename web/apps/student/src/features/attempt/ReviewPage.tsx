import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@flowcbt/api-client';
import { Button, Card, Badge, useToast } from '@flowcbt/ui';
import { db } from '../offline/db';
import { drainOutbox, newEventId } from '../offline/engine';
import { type SyncEvent } from '@flowcbt/shared';

// Konfirmasi selesai (FR-6.5): ringkasan terjawab/belum/ragu DULU, baru submit
// saat pengguna campuh "kirim". Klarifikasi hitungan: gabungan jawaban yang sudah
// ter-ACK server (GET /attempts/:id) + event pending di outbox — bukan outbox saja.
export default function ReviewPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [summary, setSummary] = useState<{ answered: number; flagged: number; total: number; pending: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Konfirmasi Selesai — FlowCBT';
    (async () => {
      const att = await db.attempts.get(id!);
      const total = att?.packet.questions.length || 0;
      const outbox = await db.outbox.where('attemptId').equals(id!).toArray();
      const answeredIds = new Set<string>();
      let flagged = false;
      // 1) jawaban yang sudah di-ACK server
      try {
        const remote = await api<any>('GET', `/attempts/${id}`);
        for (const ans of remote.answers || []) {
          if (ans.answer_json != null) answeredIds.add(ans.question_id);
          if (ans.flagged) flagged = true;
        }
      } catch { /* offline: gunakan outbox saja */ }
      // 2) event pending di outbox (menimpa status ter-ACK)
      for (const e of outbox) {
        if (e.type === 'answer' && e.question_id && e.payload != null) answeredIds.add(e.question_id);
        if (e.type === 'flag' && (e.payload as any)?.flagged) flagged = true;
      }
      setSummary({
        answered: answeredIds.size,
        flagged: flagged ? 1 : 0,
        total,
        pending: outbox.length,
      });
    })();
  }, [id]);

  const confirm = async () => {
    setBusy(true);
    try {
      const events = await db.outbox.where('attemptId').equals(id!).toArray();
      const submitEv: SyncEvent & { attemptId: string } = {
        client_event_id: newEventId(), type: 'submit',
        seq: Math.max(0, ...events.map((e) => e.seq)) + 1,
        client_ts: new Date().toISOString(), attemptId: id!,
      };
      const all = [...events, submitEv];
      let synced = false;
      if (navigator.onLine) {
        try {
          await api('POST', `/attempts/${id}/answers:sync`, { events: all, submitted: true, submit_reason: 'manual' });
          await db.outbox.where('attemptId').equals(id!).delete();
          synced = true;
        } catch { /* offline / gagal: biarkan outbox, DonePage melanjutkan */ }
      }
      if (!synced) await db.outbox.put(submitEv);
      await db.attempts.update(id!, { status: 'pending_sync', submittedLocal: true });
    } catch (err: any) {
      toast(err?.message || 'Gagal mengirim, jawaban tetap tersimpan di perangkat.', 'danger');
    } finally {
      setBusy(false);
      nav(`/attempt/${id}/done`);
    }
  };

  return (
    <div className="app-wrap" style={{ paddingTop: 24, maxWidth: 560 }}>
      <h1 style={{ fontSize: 22 }}>Konfirmasi Selesai</h1>
      <Card style={{ marginTop: 12 }}>
        {summary && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Badge tone="ok">Terjawab: {summary.answered}/{summary.total}</Badge>
            <Badge tone="muted">Belum dijawab: {summary.total - summary.answered}</Badge>
            {summary.flagged > 0 && <Badge tone="warn">Ditandai ragu-ragu</Badge>}
          </div>
        )}
        {summary && summary.answered < summary.total && (
          <div className="banner banner-warn" style={{ marginBottom: 10 }}>Masih ada {summary.total - summary.answered} soal yang belum Anda jawab.</div>
        )}
        {summary && summary.pending > 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{summary.pending} perubahan terakhir akan ikut terkirim sekarang.</p>
        )}
        <div className={navigator.onLine ? 'banner banner-ok' : 'banner banner-warn'} style={{ fontSize: 14 }}>
          {navigator.onLine
            ? 'Sedang online — jawaban akan langsung terkirim ke server.'
            : 'Sedang offline — jawaban tersimpan di perangkat dan otomatis terkirim saat koneksi pulih. Jangan hapus data browser.'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="ghost" onClick={() => nav(`/attempt/${id}`)}>Kembali ke Soal</Button>
          <Button style={{ marginLeft: 'auto' }} onClick={confirm} disabled={busy}>{busy ? 'Mengirim…' : 'Ya, Selesai & Kirim'}</Button>
        </div>
      </Card>
    </div>
  );
}
