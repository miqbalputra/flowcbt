import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, Badge } from '@flowcbt/ui';

// Super Admin console (M12, FR-12.1–12.3): tenant, paket, pembayaran, metrik.
export default function AdminPage() {
  return (
    <Routes>
      <Route path="tenants" element={<Tenants />} />
      <Route path="plans" element={<Plans />} />
      <Route path="payments" element={<Payments />} />
      <Route path="metrics" element={<Metrics />} />
      <Route path="*" element={<Tenants />} />
    </Routes>
  );
}

function Tenants() {
  const { data: rows } = useApiQuery<any[]>(['admin-tenants'], '/admin/tenants');
  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Tenant</h1>
      <div style={{ margin: '8px 0', display: 'flex', gap: 8 }}>
        <Link to="/admin/plans">Paket</Link> · <Link to="/admin/payments">Pembayaran</Link> · <Link to="/admin/metrics">Metrik</Link>
      </div>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Kode</th><th>Nama</th><th>Status</th><th>Siswa aktif</th><th>Storage</th></tr></thead>
          <tbody>
            {(rows || []).map((t) => (
              <tr key={t.id}>
                <td>{t.code}</td><td>{t.name}</td>
                <td><Badge tone={t.status === 'active' ? 'ok' : t.status === 'read_only' ? 'warn' : 'danger'}>{t.status}</Badge></td>
                <td>{t.active_students ?? 0}</td>
                <td>{((t.storage_used || 0) / 1048576).toFixed(1)} MB / {(t.storage_quota / 1073741824).toFixed(0)} GB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Plans() {
  const { data: rows } = useApiQuery<any[]>(['admin-plans'], '/admin/plans');
  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Paket & harga (dapat diubah tanpa deploy)</h1>
      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 10 }}>
        <table className="table">
          <thead><tr><th>Kode</th><th>Nama</th><th>Harga</th><th>Siswa</th><th>Kuota ujian</th><th>Aktif</th></tr></thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.code}><td>{p.code}</td><td>{p.name}</td><td>Rp {p.price_idr.toLocaleString('id-ID')}</td><td>{p.student_min}–{p.student_max}</td><td>{p.exam_quota ?? '∞'}</td><td>{p.is_active ? 'ya' : 'tidak'}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Payments() {
  const { data: rows } = useApiQuery<any[]>(['admin-pay'], '/admin/payments');
  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Pembayaran</h1>
      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 10 }}>
        <table className="table">
          <thead><tr><th>Order</th><th>Tenant</th><th>Paket</th><th>Jumlah</th><th>Provider</th><th>Status</th></tr></thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.order_id}><td>{p.order_id}</td><td>{p.tenant}</td><td>{p.plan}</td><td>Rp {p.amount_idr.toLocaleString('id-ID')}</td><td>{p.provider}</td><td><Badge tone={p.status === 'paid' ? 'ok' : 'muted'}>{p.status}</Badge></td></tr>
            ))}
            {(rows || []).length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>Belum ada.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Metrics() {
  const { data: m } = useApiQuery<any>(['admin-metrics'], '/admin/metrics');
  if (!m) return null;
  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Metrik platform</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10 }}>
        <Card>Tenant: <strong>{m.tenants}</strong> (aktif {m.tenants_active})</Card>
        <Card>User: <strong>{m.users}</strong></Card>
        <Card>Siswa: <strong>{m.students}</strong></Card>
        <Card>Ujian publish: <strong>{m.exams_published}</strong></Card>
        <Card>Attempt: <strong>{m.attempts_total}</strong> (berjalan {m.attempts_in_progress})</Card>
        <Card>Pembayaran lunas: <strong>{m.payments_paid}</strong></Card>
        <Card>Revenue: <strong>Rp {Number(m.revenue_idr).toLocaleString('id-ID')}</strong></Card>
        <Card>Ditandai curang: <strong>{m.flagged}</strong></Card>
      </div>
    </div>
  );
}
