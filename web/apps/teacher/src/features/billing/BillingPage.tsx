import React, { useState } from 'react';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Badge, useToast } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Halaman paket & langganan (FR-10.1–10.3): beli self-service via checkout, riwayat invoice.
export default function BillingPage() {
  const toast = useToast();
  const { data: plans } = useApiQuery<any[]>(['plans'], '/plans');
  const { data: sub, refetch } = useApiQuery<any>(['sub'], '/billing/subscription');
  const { data: invoices } = useApiQuery<any[]>(['inv'], '/billing/invoices');
  const [provider, setProvider] = useState('mock');

  const buy = async (code: string) => {
    try {
      const r = await api<any>('POST', '/billing/checkout', { plan_code: code, provider }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      toast(`Order ${r.order_id} dibuat (${r.amount_idr} IDR). Buka: ${r.checkout_url}`, 'ok');
      if (provider === 'mock') {
        // sandbox: langsung tandai settlement agar paket aktif (webhook mock)
        await api('POST', '/webhooks/payment/mock', { order_id: r.order_id, transaction_status: 'settlement' }, { token: false });
        toast('Pembayaran (mock) terkonfirmasi — paket aktif!', 'ok');
        refetch();
      }
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <strong>Status langganan Anda</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {sub?.monthly_active && <Badge tone="ok">Bulanan aktif s/d {fmtDateTime(sub.monthly_ends_at)}</Badge>}
          {sub?.trial_active && <Badge tone="brand">Trial — sisa {sub.trial_exams_left} ujian (s/d {fmtDateTime(sub.access_ended_at)})</Badge>}
          <Badge tone="muted">Kredit ujian: {sub?.credits_left ?? 0}</Badge>
          <Badge tone="muted">Siswa: {sub?.active_students}/{sub?.student_limit}</Badge>
          {sub?.read_only && <Badge tone="danger">Mode baca-saja — data akan dihapus setelah 7 hari kecuali diperpanjang</Badge>}
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Provider pembayaran:{' '}
            <select className="input" style={{ maxWidth: 160 }} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="mock">Mock (dev/sandbox)</option>
              <option value="midtrans">Midtrans</option>
              <option value="mayar">Mayar</option>
            </select>
          </label>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {(plans || []).filter((p) => p.type !== 'free').map((p) => (
          <Card key={p.code}>
            <strong>{p.name}</strong>
            <div style={{ fontSize: 24, margin: '6px 0' }}>Rp {p.price_idr.toLocaleString('id-ID')}{p.type === 'monthly' ? '/bulan' : ''}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {p.student_min}–{p.student_max} siswa{p.exam_quota ? ` · ${p.exam_quota}x ujian` : ' · ujian tanpa batas'}
            </div>
            <Button style={{ marginTop: 10 }} onClick={() => buy(p.code)}>Beli</Button>
          </Card>
        ))}
      </div>

      <Card>
        <strong>Riwayat invoice</strong>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>Invoice</th><th>Jumlah</th><th>Provider</th><th>Status</th><th>Tanggal</th></tr></thead>
          <tbody>
            {(invoices || []).map((i) => (
              <tr key={i.invoice_no}><td>{i.invoice_no}</td><td>Rp {i.amount_idr.toLocaleString('id-ID')}</td><td>{i.provider}</td><td>{i.status}</td><td>{fmtDateTime(i.issued_at)}</td></tr>
            ))}
            {(invoices || []).length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Belum ada transaksi.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
