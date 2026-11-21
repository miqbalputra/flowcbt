// Billing & langganan (M10 / FR-10.1..10.3): paket, kuota, checkout Midtrans/Mayar, invoice.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import {
  Callout, EmptyState, ErrorBox, PageHeader, Panel, ProgressBar, SkeletonRows,
  StatCard, StatusBadge, TableToolbar,
} from './ui'
import { asDict, asList, errMessage, fmtDate, fmtRp, statusBadge, unwrap, unwrapList, qRows } from './types'
import { IconCheck, IconCredit, IconDownload } from '@/components/icons'

const PROVIDERS = [
  { value: 'midtrans', label: 'Midtrans', note: 'VA, kartu, e-wallet' },
  { value: 'mayar', label: 'Mayar', note: 'coming soon' },
]

export default function Billing() {
  const [buying, setBuying] = useState<{ code: string; name: string } | null>(null)
  const [provider, setProvider] = useState('midtrans')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<{ redirect_url?: string; message?: string; order_id?: string; amount_idr?: number } | null>(null)
  const [invView, setInvView] = useState<Record<string, unknown> | null>(null)

  const plans = useQuery({ queryKey: ['plans'], queryFn: async () => unwrapList(await api('/plans')) })
  const sub = useQuery({ queryKey: ['billing', 'subscription'], queryFn: async () => unwrap(await api('/billing/subscription')) })
  const invoices = useQuery({ queryKey: ['billing', 'invoices'], queryFn: async () => unwrapList(await api('/billing/invoices')) })

  const s = sub.data ? asDict(sub.data) : {}
  // Kontrak backend /billing/subscription = objek kuota langsung:
  // {status, trial_ends_at, monthly_active, monthly_plan, exam_credits_remaining, max_students, students_count}
  const studentsUsed = Number(s.students_count ?? 0)
  const studentsLimit = Number(s.max_students ?? 0)
  const creditsLeft = Number(s.exam_credits_remaining ?? 0)
  const monthly = Boolean(s.monthly_active)
  const planLabel = monthly
    ? String(s.monthly_plan || 'Bulanan')
    : s.trial_ends_at
      ? 'Trial (Gratis)'
      : 'Kredit Ujian'
  const periodEnd = s.monthly_ends_at ?? s.trial_ends_at ?? s.rights_ends_at
  const quotas = sub.data
    ? [{ code: 'students', name: 'Kuota siswa', used: studentsUsed, limit: studentsLimit }]
    : []

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

  const invoiceRows = qRows(invoices)
  const paidInvoices = invoiceRows.filter(i => String(i.status ?? '') === 'paid')
  const pendingInvoices = invoiceRows.filter(i => String(i.status ?? '') === 'pending')
  const paidTotal = paidInvoices.reduce((sum, i) => sum + (Number(i.amount_idr ?? i.amount ?? 0) || 0), 0)
  const subReady = !sub.isLoading && !sub.isError
  const invoicesReady = !invoices.isLoading && !invoices.isError

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Akun & Tagihan"
        title="Langganan"
        desc="Pilih paket sesuai kebutuhan sekolah Anda, pantau kuota dan riwayat transaksi."
        icon={<IconCredit size={18} />}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
        <StatCard
          label="Siswa terdaftar"
          value={!subReady ? '—' : `${studentsUsed}/${studentsLimit || '∞'}`}
          hint={monthly ? 'paket bulanan aktif' : `${creditsLeft} kredit ujian tersisa`}
          tone="primary"
          icon={<IconCredit size={14} />}
        />
        <StatCard
          label="Invoice lunas"
          value={invoicesReady ? String(paidInvoices.length) : '—'}
          hint={fmtRp(paidTotal)}
          tone="success"
          icon={<IconCheck size={14} />}
        />
        <div className="col-span-2 lg:col-span-1">
          <StatCard
            label="Menunggu bayar"
            value={invoicesReady ? String(pendingInvoices.length) : '—'}
            hint="invoice belum dibayar"
            tone={pendingInvoices.length ? 'warn' : 'default'}
            icon={<IconCredit size={14} />}
          />
        </div>
      </div>

      {/* status langganan berjalan */}
      <Panel
        title="Langganan berjalan"
        icon={<IconCredit size={15} />}
        action={s.status ? <StatusBadge status={s.status} /> : undefined}
      >
        {sub.isLoading ? (
          <SkeletonRows rows={2} />
        ) : sub.isError ? (
          <ErrorBox error={sub.error} onRetry={() => void sub.refetch()} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="min-w-0">
              <div className="section-label">Paket aktif</div>
              <div className="truncate text-base font-bold text-primary">{sub.data ? planLabel : '—'}</div>
              <p className="mt-1 text-xs text-muted">
                {periodEnd ? `Berlaku sampai ${fmtDate(periodEnd)}` : 'Tanpa batas periode'}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-canvas px-2.5 py-2 text-xs">
                <span className="text-muted">Sisa kredit ujian</span>
                <span className="mono font-semibold">{monthly ? 'Tanpa batas' : `${creditsLeft} ujian`}</span>
              </div>
            </div>

            <div className="min-w-0 space-y-2.5">
              {quotas.length === 0 ? (
                <p className="text-sm text-muted">Belum ada data kuota.</p>
              ) : (
                quotas.map((q, i) => {
                  const used = Number(q.used ?? 0) || 0
                  const limit = Number(q.limit ?? 0) || 0
                  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
                  const tone = limit > 0 && used >= limit ? 'danger' : pct >= 80 ? 'warn' : 'primary'
                  const quotaName = String(q.name ?? q.code ?? 'Kuota')
                  return (
                    <div key={q.code ?? i} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate">{quotaName}</span>
                        <span className="mono shrink-0 text-muted">{used}/{limit || '∞'}</span>
                      </div>
                      <ProgressBar value={used} max={limit || Math.max(used, 1)} tone={tone} label={quotaName} />
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* kartu paket & harga */}
      <Panel title="Paket & harga" icon={<IconCredit size={15} />}>
        {plans.isLoading ? (
          <SkeletonRows rows={3} />
        ) : plans.isError ? (
          <ErrorBox error={plans.error} onRetry={() => void plans.refetch()} />
        ) : qRows(plans).length === 0 ? (
          <EmptyState icon={<IconCredit size={20} />} title="Paket belum tersedia">
            Coba lagi nanti ya.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {qRows(plans).map((p, i) => {
              const code = String(p.code ?? '')
              const kind = String(p.kind ?? p.type ?? '')
              const current =
                (kind === 'trial' && Boolean(s.trial_ends_at) && !monthly) ||
                (kind === 'monthly' && monthly && String(s.monthly_plan ?? '') === String(p.name ?? ''))
              const minS = Number(p.min_students ?? 0)
              const maxS = Number(p.max_students ?? 0)
              const examQuota = Number(p.exam_quota ?? 0)
              const days = Number(p.duration_days ?? 0)
              const price = Number(p.price_idr ?? p.amount_idr ?? p.price ?? 0)
              const unit =
                kind === 'monthly'
                  ? 'per bulan'
                  : kind === 'trial'
                    ? `berlaku ${days || 14} hari`
                    : 'sekali bayar'
              const quotaText = kind === 'monthly' ? 'Tanpa batas' : examQuota ? `${examQuota}x ujian` : '—'
              const canBuy = !current && kind !== 'trial'
              return (
                <article
                  key={p.code ?? i}
                  className={`flex flex-col rounded-md border bg-surface ${current ? 'border-primary ring-1 ring-primary/15' : 'border-border'}`}
                >
                  <header className="flex items-start justify-between gap-2 border-b border-border px-3.5 py-2.5">
                    <div className="min-w-0">
                      <h3 className="truncate text-[13px] font-bold leading-tight">{String(p.name ?? code)}</h3>
                      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        {kind === 'monthly' ? 'Langganan bulanan' : kind === 'trial' ? 'Paket awal' : 'Paket per ujian'}
                      </p>
                    </div>
                    {current && <span className="badge border border-primary-line bg-primary-soft text-primary">Aktif</span>}
                  </header>

                  <div className="px-3.5 pt-3">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="mono text-xl font-bold leading-none text-text">
                        {price === 0 ? 'Gratis' : fmtRp(price)}
                      </span>
                      <span className="text-[11px] text-muted">{unit}</span>
                    </div>

                    <p className="mt-1.5 min-h-[34px] text-[11.5px] leading-snug text-muted">
                      {String(p.description ?? (kind === 'monthly' ? 'Ujian tanpa batas selama periode aktif.' : 'Kuota ujian tidak kedaluwarsa.'))}
                    </p>

                    <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border pt-2.5">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted">Peserta</dt>
                        <dd className="mono mt-0.5 text-[12px] font-semibold text-text">{minS}–{maxS} siswa</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted">Kuota ujian</dt>
                        <dd className="mt-0.5 text-[12px] font-semibold text-text">{quotaText}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="mt-auto p-3">
                    <button
                      type="button"
                      className={`${canBuy ? 'btn-primary' : 'btn-ghost'} btn-block`}
                      disabled={!canBuy}
                      onClick={() => { setProvider('midtrans'); setReceipt(null); setBuying({ code, name: String(p.name ?? code) }) }}
                    >
                      {current ? 'Paket aktif' : kind === 'trial' ? 'Sudah digunakan' : 'Beli paket'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Panel>

      {/* riwayat invoice */}
      <Panel
        title="Riwayat transaksi"
        icon={<IconCredit size={15} />}
        flush
        footer={
          <span className="text-xs text-muted">
            Total <span className="mono font-semibold text-text">{invoiceRows.length}</span> invoice · lunas{' '}
            <span className="mono font-semibold text-text">{fmtRp(paidTotal)}</span>
          </span>
        }
      >
        <div className="border-b border-border p-3">
          <TableToolbar count={invoiceRows.length} label="invoice" />
        </div>

        {invoices.isLoading ? (
          <div className="p-3">
            <SkeletonRows rows={3} cols={4} />
          </div>
        ) : invoices.isError ? (
          <div className="p-3">
            <ErrorBox error={invoices.error} onRetry={() => void invoices.refetch()} />
          </div>
        ) : invoiceRows.length === 0 ? (
          <EmptyState icon={<IconCredit size={20} />} title="Belum ada transaksi">
            Invoice pembelian paket akan tercatat di sini.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col" className="num">Nominal</th>
                  <th scope="col">Status</th>
                  <th scope="col">Tanggal</th>
                  <th scope="col" className="num">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {invoiceRows.map((inv, i) => (
                  <tr key={inv.order_id ?? i}>
                    <td data-th="Invoice">
                      <span className="mono block max-w-40 truncate font-semibold" title={String(inv.invoice_number ?? inv.order_id ?? '—')}>
                        {String(inv.invoice_number ?? inv.order_id ?? '—')}
                      </span>
                    </td>
                    <td data-th="Nominal" className="num">
                      <span className="mono font-semibold">{fmtRp(inv.amount_idr ?? inv.amount ?? 0)}</span>
                    </td>
                    <td data-th="Status"><StatusBadge status={inv.status} /></td>
                    <td data-th="Tanggal" className="whitespace-nowrap">{fmtDate(inv.created_at ?? inv.paid_at)}</td>
                    <td data-th="Aksi" className="num">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setInvView(inv)}>
                        Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={!!invView}
        onClose={() => setInvView(null)}
        title="Detail transaksi"
        footer={<button type="button" className="btn-primary" onClick={() => setInvView(null)}>Tutup</button>}
      >
        {invView && (
          <dl className="divide-y divide-border text-sm">
            {[
              ['Nomor invoice', String(invView.order_id ?? invView.invoice_number ?? '—')],
              ['Paket', String(invView.plan_name ?? invView.plan_code ?? '—')],
              ['Nominal', fmtRp(invView.amount_idr ?? invView.amount ?? 0)],
              ['Status', String(statusBadge(invView.status).label)],
              ['Metode', String(invView.provider ?? '—')],
              ['Tanggal', fmtDate(invView.created_at ?? invView.paid_at)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-2">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className={`mono text-right text-[13px] font-semibold ${k === 'Nomor invoice' ? 'break-all' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>

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
        <div className="space-y-2">
          <div className="section-label">Metode pembayaran</div>
          {PROVIDERS.map(p => (
            <label key={p.value} className="choice" data-active={provider === p.value ? 'true' : 'false'}>
              <input
                type="radio"
                name="provider"
                checked={provider === p.value}
                onChange={() => setProvider(p.value)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{p.label}</span>
                <span className="block text-xs text-muted">{p.note}</span>
              </span>
            </label>
          ))}
          <p className="hint">Paket aktif otomatis setelah pembayaran dikonfirmasi penyedia.</p>
        </div>
      </Modal>

      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title="Instruksi pembayaran"
        footer={<button type="button" className="btn-primary" onClick={() => setReceipt(null)}>Tutup</button>}
      >
        {receipt?.redirect_url ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">Halaman pembayaran terbuka di tab baru. Selesai bayar, paket aktif otomatis.</p>
            <a className="btn-primary btn-block" href={receipt.redirect_url} target="_blank" rel="noopener noreferrer">
              Buka halaman pembayaran
            </a>
          </div>
        ) : receipt?.message ? (
          <Callout tone="warn">{receipt.message}</Callout>
        ) : null}

        {receipt?.order_id && (
          <dl className="space-y-1 rounded-md border border-border bg-canvas p-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-xs text-muted">ID pesanan</dt>
              <dd className="mono min-w-0 truncate font-semibold">{receipt.order_id}</dd>
            </div>
            {receipt.amount_idr !== undefined && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-xs text-muted">Nominal</dt>
                <dd className="mono font-semibold">{fmtRp(receipt.amount_idr)}</dd>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </div>
  )
}
