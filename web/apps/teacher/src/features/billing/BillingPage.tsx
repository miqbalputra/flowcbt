import React, { useState } from 'react';
import { api, useApiQuery, QueryError } from '@flowcbt/api-client';
import { Button, Card, Badge, useToast, SkeletonList, SkeletonTableRows, PageHeader, EmptyState, Icon } from '@flowcbt/ui';
import { fmtDateTime } from '@flowcbt/shared';

// Halaman paket & langganan (FR-10.1–10.3): beli self-service via checkout, riwayat invoice.
export default function BillingPage() {
  const { data: plans, isLoading: lPlans, error: ePlans } = useApiQuery<any[]>(['plans'], '/plans');
  const { data: sub, refetch, isLoading: lSub, error: eSub } = useApiQuery<any>(['sub'], '/billing/subscription');
  const { data: invoices, isLoading: lInv, error: eInv } = useApiQuery<any[]>(['inv'], '/billing/invoices');
  const [provider, setProvider] = useState('mock');
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const toast = useToast();

  const buy = async (code: string) => {
    try {
      const r = await api<any>('POST', '/billing/checkout', { plan_code: code, provider }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      // A-13: tautan pembayaran ditampilkan permanen, bukan hanya toast 4 detik.
      setCheckoutUrl(r.checkout_url);
      toast(`Order ${r.order_id} dibuat (Rp ${r.amount_idr.toLocaleString('id-ID')}).`, 'ok');
      if (provider === 'mock') {
        // sandbox: langsung tandai settlement agar paket aktif (webhook mock)
        await api('POST', '/webhooks/payment/mock', { order_id: r.order_id, transaction_status: 'settlement' }, { token: false });
        toast('Pembayaran (mock) terkonfirmasi — paket aktif!', 'ok');
        refetch();
      }
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  const quota = sub ? `${sub.active_students}/${sub.student_limit} siswa` : '';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PageHeader
        title="Langganan"
        subtitle="Pilih paket sesuai jumlah siswa Anda. Semua fitur tersedia di semua paket."
      />

      <Card>
        <div className="card-title">Status langganan</div>
        {eSub ? (
          <QueryError error={eSub} onRetry={refetch} />
        ) : lSub ? (
          <SkeletonList rows={2} height={22} />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {sub?.monthly_active && <Badge tone="ok"><Icon name="check" /> Bulanan aktif s/d {fmtDateTime(sub.monthly_ends_at)}</Badge>}
              {sub?.trial_active && <Badge tone="brand"><Icon name="clock" /> Trial — sisa {sub.trial_exams_left} ujian (s/d {fmtDateTime(sub.access_ended_at)})</Badge>}
              <Badge tone="muted">Kredit ujian: {sub?.credits_left ?? 0}</Badge>
              <Badge tone="muted">{quota}</Badge>
            </div>
            {sub?.read_only && (
              <div className="banner banner-danger">
                <Icon name="alert-triangle" />
                <span>Mode baca-saja: data akan dihapus permanen dalam 7 hari kecuali diperpanjang. Perpanjang sekarang untuk memulihkan akses penuh.</span>
              </div>
            )}
          </div>
        )}
      </Card>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="card-title">Beli paket</div>
          <label className="field" style={{ margin: 0 }}>
            <span className="field-label">Metode pembayaran</span>
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)} style={{ width: 'auto' }}>
              <option value="mock">Mock (dev/sandbox)</option>
              <option value="midtrans">Midtrans</option>
              <option value="mayar">Mayar</option>
            </select>
          </label>
        </div>
        {ePlans && <QueryError error={ePlans} />}
        {checkoutUrl && (
          <Card style={{ marginTop: 12 }}>
            <div className="card-title">Tautan pembayaran terakhir</div>
            <a href={checkoutUrl} target="_blank" rel="noopener noreferrer">{checkoutUrl}</a>
          </Card>
        )}
        {eInv && <QueryError error={eInv} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
          {lPlans && <Card aria-busy="true"><SkeletonList rows={3} height={22} /></Card>}
          {!lPlans && (plans || []).filter((p) => p.type !== 'free').map((p) => (
            <Card key={p.code} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>{p.name}</strong>
              <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                Rp {p.price_idr.toLocaleString('id-ID')}{p.type === 'monthly' ? <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>/bulan</span> : ''}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
                {p.student_min}–{p.student_max} siswa{p.exam_quota ? ` · ${p.exam_quota}x ujian` : ' · ujian tanpa batas'}
              </div>
              <Button style={{ marginTop: 8 }} onClick={() => buy(p.code)}>Beli paket</Button>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <div className="card-title">Riwayat invoice</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Invoice</th><th>Jumlah</th><th>Provider</th><th>Status</th><th>Tanggal</th></tr></thead>
            {lInv ? (
              <tbody><tr><td colSpan={5}><SkeletonList rows={3} height={22} /></td></tr></tbody>
            ) : (
              <tbody>
                {(invoices || []).map((i) => (
                  <tr key={i.invoice_no}>
                    <td>{i.invoice_no}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>Rp {i.amount_idr.toLocaleString('id-ID')}</td>
                    <td>{i.provider}</td>
                    <td><Badge tone={i.status === 'paid' ? 'ok' : 'muted'}>{i.status}</Badge></td>
                    <td>{fmtDateTime(i.issued_at)}</td>
                  </tr>
                ))}
                {(invoices || []).length === 0 && <tr><td colSpan={5}><EmptyState icon="doc" title="Belum ada transaksi">Invoice akan muncul di sini setelah pembayaran pertama.</EmptyState></td></tr>}
              </tbody>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
