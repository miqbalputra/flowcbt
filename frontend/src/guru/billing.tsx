// Billing & langganan (M10 / FR-10.1..10.3): paket, checkout Midtrans/Mayar, invoice
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, StatusBadge } from './ui'
import {  asDict, asList, errMessage, fmtDate, fmtRp, unwrap, unwrapList, qRows } from './types'

const PROVIDERS = [
  { value: 'midtrans', label: 'Midtrans', note: 'VA, kartu, e-wallet' },
  { value: 'mayar', label: 'Mayar', note: 'coming soon' },
]

export default function Billing() {
  const [buying, setBuying] = useState<{ code: string; name: string } | null>(null)
  const [provider, setProvider] = useState('midtrans')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<{ redirect_url?: string; message?: string; order_id?: string; amount_idr?: number } | null>(null)

  const plans = useQuery({ queryKey: ['plans'], queryFn: () => unwrapList(api('/plans')) })
  const sub = useQuery({ queryKey: ['billing', 'subscription'], queryFn: async () => unwrap(await api('/billing/subscription')) })
  const invoices = useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => unwrapList(api('/billing/invoices')) })

  const s = sub.data ? asDict(sub.data) : {}
  const quotas = sub.data ? asList(s.quotas ?? s.quota ?? []) : []

  async function checkout() {
    if (!buying) return
    setBusy(true)
    try {
      const res = unwrap(await send('/billing/checkout', { plan_code: buying.code, provider }, 'POST'))
      const d = asDict(res)
      const receiptInfo = {
        redirect_url: typeof d.redirect_url === 'string' ? d.redirect_url : undefined,
        message: typeof d.message === 'string' ? d.message : undefined,
        order_id: typeof d.order_id === 'string' ? d.order_id : undefined,
        amount_idr: d.amount_idr !== undefined ? Number(d.amount_idr) : undefined,
      }
      setReceipt(receiptInfo)
      setBuying(null)
      if (receiptInfo.redirect_url) {
        toast('Membuka halaman pembayaran…', 'info')
        window.open(receiptInfo.redirect_url, '_blank', 'noopener')
      } else {
        void invoices.refetch()
      }
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Langganan" desc="Pilih paket sesuai kebutuhan sekolah Anda." />

      {/* status langganan berjalan */}
      <div className="card space-y-3">
        <h3 className="font-semibold">Status langganan</h3>
        {sub.isLoading ? (
          <SkeletonRows rows={2} />
        ) : sub.isError ? (
          <ErrorBox error={sub.error} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span>Paket: <b className="text-primary">{String(s.plan_name ?? s.plan_code ?? '—')}</b></span>
              {s.status && <span>Status: <StatusBadge status={s.status} /></span>}
              {s.current_period_end && <span className="text-muted">Berakhir {fmtDate(s.current_period_end)}</span>}
            </div>
            {quotas.map((q, i) => {
              const used = Number(q.used ?? 0)
              const limit = Number(q.limit ?? 0)
              return (
                <div key={q.code ?? i} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{String(q.name ?? q.code ?? 'Kuota')}</span>
                    <span className="text-muted">{used}/{limit || '∞'}</span>
                  </div>
                  <div className="h-2 rounded-full bg-border/40">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${limit ? Math.min(100, Math.round((used / limit) * 100)) : 0}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* kartu paket & harga */}
      <div>
        <h3 className="font-semibold mb-2">📦 Paket & harga</h3>
        {plans.isLoading ? (
          <SkeletonRows rows={3} />
        ) : plans.isError ? (
          <ErrorBox error={plans.error} />
        ) : qRows(plans).length === 0 ? (
          <EmptyState icon="💳" title="Paket belum tersedia" children="Coba lagi nanti ya." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {qRows(plans).map((p, i) => {
              const code = String(p.code ?? '')
              const current = String(s.plan_code ?? '') === code
              return (
                <div key={p.code ?? i} className={`card flex flex-col ${current ? 'border-primary' : ''}`}>
                  <div className="font-semibold">{String(p.name ?? code)}</div>
                  <div className="text-2xl font-bold text-primary my-2">
                    {fmtRp(p.price_idr ?? p.amount_idr ?? p.price ?? 0)}
                    <span className="text-xs font-normal text-muted">/{String(p.period ?? 'bulan')}</span>
                  </div>
                  {Array.isArray(p.features) && (
                    <ul className="text-sm text-muted space-y-1 mb-3 flex-1">
                      {p.features.map((f, j) => <li key={j}>✓ {String(f)}</li>)}
                    </ul>
                  )}
                  <button
                    type="button"
                    className={current ? 'btn-ghost' : 'btn-primary'}
                    disabled={current}
                    onClick={() => { setProvider('midtrans'); setReceipt(null); setBuying({ code, name: String(p.name ?? code) }) }}
                  >
                    {current ? 'Paket aktif' : 'Beli paket'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* riwayat invoice */}
      <div>
        <h3 className="font-semibold mb-2">🧾 Riwayat transaksi</h3>
        {invoices.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : invoices.isError ? (
          <ErrorBox error={invoices.error} />
        ) : qRows(invoices).length === 0 ? (
          <EmptyState icon="🧾" title="Belum ada transaksi" />
        ) : (
          <table className="table-base responsive-table">
            <thead>
              <tr>
                <th>Invoice</th><th>Nominal</th><th>Status</th><th>Tgl bayar</th><th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {qRows(invoices).map((inv, i) => (
                <tr key={inv.order_id ?? i}>
                  <td data-th="Invoice">
                    <div className="font-medium truncate max-w-40">{String(inv.invoice_number ?? inv.order_id ?? '—')}</div>
                  </td>
                  <td data-th="Nominal">{fmtRp(inv.amount_idr ?? inv.amount ?? 0)}</td>
                  <td data-th="Status"><StatusBadge status={inv.status} /></td>
                  <td data-th="Tgl bayar">{inv.paid_at ? fmtDate(inv.paid_at) : '—'}</td>
                  <td data-th="PDF">
                    {typeof inv.invoice_url === 'string' && inv.invoice_url ? (
                      <a className="text-primary hover:underline" href={inv.invoice_url} target="_blank" rel="noopener">Unduh</a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={!!buying}
        onClose={() => setBuying(null)}
        title={`Beli paket ${buying?.name ?? ''}`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setBuying(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={checkout} disabled={busy}>
              {busy ? 'Memproses…' : 'Lanjut bayar'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-muted">Pilih metode pembayaran:</div>
          {PROVIDERS.map(p => (
            <label key={p.value} className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer min-h-[44px]">
              <input type="radio" name="provider" checked={provider === p.value} onChange={() => setProvider(p.value)} />
              <span className="font-medium">{p.label}</span>
              <span className="text-xs text-muted ml-auto">{p.note}</span>
            </label>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title="Instruksi pembayaran"
        footer={<button type="button" className="btn-primary" onClick={() => setReceipt(null)}>Tutup</button>}
      >
        {receipt?.redirect_url ? (
          <>
            <p className="text-sm">Halaman pembayaran terbuka di tab baru. Selesai bayar, paket aktif otomatis ✅</p>
            <a className="btn-primary" href={receipt.redirect_url} target="_blank" rel="noopener noreferrer">Buka halaman pembayaran</a>
          </>
        ) : (
          receipt?.message && <div className="text-sm rounded-lg p-3 bg-warn/10 text-warn">{receipt.message}</div>
        )}
        {receipt?.order_id && (
          <div className="text-sm space-y-1">
            <div>ID pesanan: <b>{receipt.order_id}</b></div>
            {receipt.amount_idr !== undefined && <div>Nominal: <b>{fmtRp(receipt.amount_idr)}</b></div>}
          </div>
        )}
      </Modal>
    </div>
  )
}
