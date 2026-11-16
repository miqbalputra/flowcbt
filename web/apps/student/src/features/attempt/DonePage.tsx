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
    <div className="app-wrap" style={{ maxWidth: 560, paddingTop: '18vh' }}>
      <Card style={{ textAlign: 'center', display: 'grid', justifyItems: 'center' }}>
        <span aria-hidden="true" style={{
          width: 64, height: 64, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--ok-bg)', color: 'var(--ok)', marginBottom: 12,
        }}>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.5 5 5 10-11" /></svg>
        </span>
        <h1 style={{ fontSize: 24 }}>Selesai</h1>
        <p style={{ margin: '10px 0 0' }}><ConnectionBadge online={online} pending={pending} /></p>
        {pending > 0 && <p style={{ fontSize: 14, color: 'var(--warn-text)', background: 'var(--warn-bg)', borderRadius: 10, padding: '8px 14px' }}>
          Jawaban tersimpan di perangkat — menunggu internet untuk terkirim ({pending} kelompok data). Jangan hapus data browser.
        </p>}
        {result?.score_visible ? (
          <div style={{ marginTop: 14 }}>
            <div className="stat-label">Nilai Anda</div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{result.final_score}</div>
            <div className="card-sub">dari 100</div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              {result.provisional && <Badge tone="warn">Sementara — menunggu penilaian uraian</Badge>}
              {result.passed != null && <Badge tone={result.passed ? 'ok' : 'danger'}>{result.passed ? 'Lulus' : 'Belum lulus'}</Badge>}
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Nilai akan diumumkan oleh guru.</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'center' }}>
          <Link to="/exams"><Button>Kembali ke Ujian</Button></Link>
          <Link to="/history"><Button variant="ghost">Riwayat</Button></Link>
        </div>
      </Card>
    </div>
  );
}
