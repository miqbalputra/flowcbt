import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@flowcbt/api-client';
import { Button, Card, Badge, ConnectionBadge } from '@flowcbt/ui';
import { db } from '../offline/db';
import { drainOutbox } from '../offline/engine';

// Layar selesai (FR-6.5): status sinkron + nilai bila diizinkan; tetap menyinkron di background saat offline (AC-4).
export default function DonePage() {
  const { id } = useParams();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    const sync = async () => {
      const events = await db.outbox.where('attemptId').equals(id!).toArray();
      setPending(events.length);
      if (navigator.onLine && events.length) {
        try {
          await drainOutbox(id!, {
            getAll: (a) => db.outbox.where('attemptId').equals(a).toArray(),
            put: async (e) => { await db.outbox.put({ ...e, attemptId: id } as any); },
            deleteMany: async (ids) => { await db.outbox.where('client_event_id').anyOf(ids).delete(); },
          }, async (attemptId, evs) => api('POST', `/attempts/${attemptId}/answers:sync`, { events: evs, submitted: true, submit_reason: 'offline_sync' }), setPending);
        } catch {}
      }
      try { setResult(await api('GET', `/attempts/${id}/result`)); } catch {}
    };
    void sync();
    const t = setInterval(sync, 5000);
    const on = () => { setOnline(true); void sync(); };
    window.addEventListener('online', on);
    return () => { clearInterval(t); window.removeEventListener('online', on); };
  }, [id]);

  return (
    <div style={{ maxWidth: 560, margin: '8vh auto', padding: 16 }}>
      <Card>
        <h1 style={{ fontSize: 24, marginTop: 0 }}>✅ Selesai</h1>
        <p><ConnectionBadge online={online} pending={pending} /></p>
        {pending > 0 && <p style={{ fontSize: 14 }}>Jawaban tersimpan di perangkat — menunggu internet untuk terkirim ({pending} event).</p>}
        {result?.score_visible ? (
          <div>
            <p>Nilai Anda: <strong style={{ fontSize: 28 }}>{result.final_score}</strong> / 100</p>
            {result.provisional && <Badge tone="warn">Sementara (menunggu penilaian uraian guru)</Badge>}
            {result.passed != null && <Badge tone={result.passed ? 'ok' : 'danger'}>{result.passed ? 'Lulus' : 'Belum lulus'}</Badge>}
          </div>
        ) : (
          <p>Nilai akan diumumkan oleh guru.</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Link to="/exams"><Button>Kembali ke Ujian</Button></Link>
          <Link to="/history"><Button variant="ghost">Riwayat</Button></Link>
        </div>
      </Card>
    </div>
  );
}
