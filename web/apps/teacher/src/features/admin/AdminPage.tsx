import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useApiQuery } from '@flowcbt/api-client';
import { Card, Badge, SkeletonTableRows, PageHeader, StatCard, Icon } from '@flowcbt/ui';

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

function AdminNav() {
  const cls = ({ isActive }: { isActive: boolean }) => 'navlink' + (isActive ? ' active' : '');
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8, marginBottom: 4 }}>
      <NavLink to="/admin/tenants" className={cls}>Tenant</NavLink>
      <NavLink to="/admin/plans" className={cls}>Paket</NavLink>
      <NavLink to="/admin/payments" className={cls}>Pembayaran</NavLink>
      <NavLink to="/admin/metrics" className={cls}>Metrik</NavLink>
    </div>
  );
}

function Tenants() {
  const { data: rows, isLoading } = useApiQuery<any[]>(['admin-tenants'], '/admin/tenants');
  return (
    <div>
      <PageHeader title="Konsol Super Admin" subtitle="Kelola tenant, paket, pembayaran, dan metrik platform." />
      <AdminNav />
      <Card style={{ marginTop: 8 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Kode</th><th>Nama</th><th>Status</th><th>Siswa aktif</th><th>Storage</th></tr></thead>
            <tbody>
              {isLoading && <SkeletonTableRows cols={5} rows={3} />}
              {(rows || []).map((t) => (
                <tr key={t.id}>
                  <td>{t.code}</td><td>{t.name}</td>
                  <td><Badge tone={t.status === 'active' ? 'ok' : t.status === 'read_only' ? 'warn' : 'danger'}>{t.status}</Badge></td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t.active_students ?? 0}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{((t.storage_used || 0) / 1048576).toFixed(1)} MB / {(t.storage_quota / 1073741824).toFixed(0)} GB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Plans() {
  const { data: rows, isLoading } = useApiQuery<any[]>(['admin-plans'], '/admin/plans');
  return (
    <div>
      <PageHeader title="Paket & harga" subtitle="Perubahan di sini berlaku seketika tanpa deploy ulang." />
      <AdminNav />
      <Card style={{ marginTop: 8 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Kode</th><th>Nama</th><th>Harga</th><th>Siswa</th><th>Kuota ujian</th><th>Aktif</th></tr></thead>
            <tbody>
              {isLoading && <SkeletonTableRows cols={6} rows={4} />}
              {(rows || []).map((p) => (
                <tr key={p.code}>
                  <td>{p.code}</td><td>{p.name}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>Rp {p.price_idr.toLocaleString('id-ID')}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.student_min}–{p.student_max}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.exam_quota ?? '∞'}</td>
                  <td><Badge tone={p.is_active ? 'ok' : 'muted'}>{p.is_active ? 'aktif' : 'nonaktif'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Payments() {
  const { data: rows, isLoading } = useApiQuery<any[]>(['admin-pay'], '/admin/payments');
  return (
    <div>
      <PageHeader title="Pembayaran" subtitle="Transaksi lintas tenant." />
      <AdminNav />
      <Card style={{ marginTop: 8 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Order</th><th>Tenant</th><th>Paket</th><th>Jumlah</th><th>Provider</th><th>Status</th></tr></thead>
            <tbody>
              {isLoading && <SkeletonTableRows cols={6} rows={3} />}
              {(rows || []).map((p) => (
                <tr key={p.order_id}>
                  <td>{p.order_id}</td><td>{p.tenant}</td><td>{p.plan}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>Rp {p.amount_idr.toLocaleString('id-ID')}</td>
                  <td>{p.provider}</td>
                  <td><Badge tone={p.status === 'paid' ? 'ok' : 'muted'}>{p.status}</Badge></td>
                </tr>
              ))}
              {!isLoading && (rows || []).length === 0 && <tr><td colSpan={6}><EmptyInline label="Belum ada transaksi pembayaran." /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Metrics() {
  const { data: m, isLoading } = useApiQuery<any>(['admin-metrics'], '/admin/metrics');
  if (isLoading || !m) return <div><PageHeader title="Metrik platform" subtitle="Memuat…" /><AdminNav /></div>;
  return (
    <div>
      <PageHeader title="Metrik platform" subtitle="Ringkasan penggunaan seluruh tenant." />
      <AdminNav />
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginTop: 12 }}>
        <StatCard label="Tenant" value={m.tenants} hint={`${m.tenants_active} aktif`} />
        <StatCard label="Pengguna" value={m.users} />
        <StatCard label="Siswa" value={m.students} />
        <StatCard label="Ujian publish" value={m.exams_published} />
        <StatCard label="Attempt" value={m.attempts_total} hint={`${m.attempts_in_progress} berjalan`} />
        <StatCard label="Pembayaran lunas" value={m.payments_paid} />
        <StatCard label="Revenue" value={`Rp ${Number(m.revenue_idr).toLocaleString('id-ID')}`} />
        <StatCard label="Ditandai curang" value={m.flagged} />
      </div>
    </div>
  );
}

function EmptyInline({ label }: { label: string }) {
  return <div style={{ padding: '18px 8px', textAlign: 'center', color: 'var(--text-muted)' }}><Icon name="info" /> {label}</div>;
}
