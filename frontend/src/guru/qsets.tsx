// Daftar paket soal (FR-4.1): status, edit/duplikat/arsip/export, tombol baru
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog } from '@/components/modal'
import {
  EmptyState, ErrorBox, PageHeader, Panel, SearchBox, SkeletonRows, StatCard, StatusBadge,
  TableToolbar, Tabs,
} from './ui'
import {
  IconBank, IconCheck, IconClipboard, IconClock, IconCopy, IconDownload, IconEdit, IconPlus, IconTrash,
} from '@/components/icons'
import { asDict, asList, errMessage, qs, qRows, unwrap, unwrapList } from './types'
import { downloadFile } from './files'

/** "3 menit lalu" — ringkas untuk kartu bank soal. */
function relTime(v: unknown): string {
  const t = Date.parse(String(v ?? ''))
  if (!t) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'baru saja'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} menit lalu`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} jam lalu`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} hari lalu`
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_TABS = [
  { key: '', label: 'Semua' },
  { key: 'draft', label: 'Draft' },
  { key: 'published', label: 'Terbit' },
  { key: 'archived', label: 'Arsip' },
]

export default function Qsets() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [archiving, setArchiving] = useState<{ id: string; title: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useQuery({
    queryKey: ['question-sets', status, q],
    queryFn: async () => unwrapList(await api(`/question-sets${qs({ status: status || undefined, q: q || undefined })}`)),
  })

  function refresh() { void qc.invalidateQueries({ queryKey: ['question-sets'] }) }

  async function duplicate(row: Record<string, any>) {
    setBusy(true)
    try {
      const res = unwrap(await api(`/question-sets/${row.id}`))
      const src = asDict(res)
      const created = unwrap(await send('/question-sets', ({
          subject_name: src.subject_name,
          title: `${String(src.title ?? 'Paket')} (salinan)`,
          description: src.description,
          level_tag: src.level_tag ?? '',
        }), 'POST'))
      const setId = String(asDict(created).id ?? '')
      // salin per soal (kontrak API: 1 endpoint per soal)
      for (const question of asList(src.questions ?? [])) {
        const questionData = asDict(question)
        const { id: _omit, ...payload } = questionData
        void _omit
        await send(`/question-sets/${setId}/questions`, payload, 'POST')
      }
      toast('Paket soal diduplikasi', 'success')
      refresh()
      nav(`/question-sets/${setId}/edit`)
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!archiving) return
    setBusy(true)
    try {
      await send(`/question-sets/${archiving.id}`, { status: 'archived' }, 'PUT')
      toast('Paket diarsipkan', 'success')
      setArchiving(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function exportXlsx(row: Record<string, any>) {
    try {
      await downloadFile(`/question-sets/${row.id}/export`, `${String(row.title ?? 'paket-soal')}.xlsx`)
      toast('Paket soal diunduh', 'success')
    } catch (err) {
      toast(errMessage(err), 'error')
    }
  }

  const rows = qRows(list)
  const [sort, setSort] = useState<'updated' | 'title'>('updated')
  const sorted = useMemo(() => {
    const copy = [...rows]
    if (sort === 'title') copy.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'id'))
    else copy.sort((a, b) => (Date.parse(String(b.updated_at ?? '')) || 0) - (Date.parse(String(a.updated_at ?? '')) || 0))
    return copy
  }, [rows, sort])
  const publishedCount = rows.filter(r => String(r.status ?? '') === 'published').length
  const draftCount = rows.filter(r => String(r.status ?? '') === 'draft').length
  const itemCount = (r: Record<string, any>) =>
    Number(r.question_count ?? r.questions_count ?? (Array.isArray(r.questions) ? r.questions.length : 0)) || 0
  const questionCount = rows.reduce((n, r) => n + itemCount(r), 0)
  const hasFilter = Boolean(q.trim()) || status !== ''

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Akademik · Bank Soal"
        title="Paket Soal"
        desc="Bank soal AKM: pilihan ganda, kompleks, menjodohkan, isian, uraian."
        icon={<IconBank size={18} />}
        action={
          <button type="button" className="btn-primary" onClick={() => nav('/question-sets/new/edit')}>
            <IconPlus size={16} /> Paket Baru
          </button>
        }
      />

      {/* ringkasan daftar (mengikuti filter aktif di server) */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard
          label="Paket tampil"
          value={String(rows.length)}
          hint="sesuai filter aktif"
          tone="primary"
          icon={<IconBank size={14} />}
        />
        <StatCard
          label="Terbit"
          value={String(publishedCount)}
          hint="siap dipakai ujian"
          tone="success"
          icon={<IconCheck size={14} />}
        />
        <StatCard
          label="Draft"
          value={String(draftCount)}
          hint="belum terbit"
          icon={<IconEdit size={14} />}
        />
        <StatCard
          label="Total soal"
          value={String(questionCount)}
          hint="butir pada daftar ini"
          icon={<IconClipboard size={14} />}
        />
      </div>

      <Panel title="Daftar paket soal" icon={<IconBank size={15} />} flush>
        {/* filter status sebagai tab garis bawah */}
        <div className="px-3 pt-1">
          <Tabs items={STATUS_TABS} value={status} onChange={setStatus} ariaLabel="Filter status paket" />
        </div>

        {/* toolbar pencarian */}
        <div className="border-b border-border p-3">
          <TableToolbar count={sorted.length} label="paket">
            <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
              <SearchBox
                className="w-full sm:w-72"
                label="Cari paket soal"
                placeholder="Cari judul / mapel / kode…"
                value={q}
                onChange={setQ}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Urutkan
                <select
                  className="input !min-h-8 !w-auto !py-1 text-xs"
                  aria-label="Urutan paket"
                  value={sort}
                  onChange={e => setSort(e.target.value as 'updated' | 'title')}
                >
                  <option value="updated">Terbaru diperbarui</option>
                  <option value="title">Judul A–Z</option>
                </select>
              </label>
            </div>
          </TableToolbar>
        </div>

        {list.isLoading ? (
          <div className="p-3"><SkeletonRows rows={4} cols={5} /></div>
        ) : list.isError ? (
          <div className="p-3"><ErrorBox error={list.error} onRetry={() => list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconBank size={20} />}
            title={hasFilter ? 'Tidak ada paket yang cocok' : 'Belum ada paket soal'}
          >
            {hasFilter
              ? 'Ubah kata kunci pencarian atau filter status di atas.'
              : 'Klik tombol "Paket Baru" untuk mulai menulis soal.'}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" role="list" aria-label="Daftar paket soal">
            {sorted.map((r, i) => {
              const status = String(r.status ?? 'draft')
              const title = String(r.title ?? 'Tanpa judul')
              const desc = String(r.description ?? '').trim()
              const kode = String(r.exam_code ?? '').trim()
              const when = relTime(r.updated_at)
              return (
                <article
                  key={String(r.id ?? i)} role="listitem" className="qcard"
                  aria-label={`Paket ${title} — ${status}${kode ? `, kode ${kode}` : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <StatusBadge status={status} />
                    <span className="flex items-center gap-1 text-[11px] text-muted" title={when}>
                      <IconClock size={12} /> {when || '—'}
                    </span>
                  </div>

                  <button
                    type="button" className="mt-2.5 block w-full text-left"
                    onClick={() => nav(`/question-sets/${r.id}/edit`)}
                    aria-label={`Buka editor paket ${title}`}
                  >
                    <h3 className="line-clamp-2 text-[15px] font-bold leading-snug transition-colors hover:text-primary">
                      {title}
                    </h3>
                    {desc && <p className="mt-1 line-clamp-1 text-xs text-muted">{desc}</p>}
                  </button>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="chip max-w-[10rem] truncate">{String(r.subject_name ?? r.subject ?? '—')}</span>
                    {kode && <span className="chip mono">{kode}</span>}
                    <span className="chip">
                      <IconClipboard size={12} /> {itemCount(r)} soal
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                    <button
                      type="button" className="btn-ghost btn-sm !text-primary"
                      onClick={() => nav(`/question-sets/${r.id}/edit`)}
                    >
                      <IconEdit size={13} /> Buka editor
                    </button>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button" className="btn-quiet btn-sm !px-1.5" disabled={busy} title="Duplikat paket"
                        aria-label={`Duplikat paket ${title}`} onClick={() => void duplicate(r)}
                      >
                        <IconCopy size={14} />
                      </button>
                      <button
                        type="button" className="btn-quiet btn-sm !px-1.5" title="Export ke Excel"
                        aria-label={`Export paket ${title}`} onClick={() => void exportXlsx(r)}
                      >
                        <IconDownload size={14} />
                      </button>
                      <button
                        type="button" className="btn-quiet btn-sm !px-1.5 text-muted hover:!text-danger" disabled={busy}
                        title="Arsipkan" aria-label={`Arsipkan paket ${title}`}
                        onClick={() => setArchiving({ id: String(r.id ?? ''), title })}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={!!archiving}
        message={`Arsipkan paket "${archiving?.title}"? Paket tidak akan muncul saat memilih paket ujian.`}
        danger busy={busy} confirmLabel="Ya, arsipkan"
        onConfirm={archive}
        onClose={() => setArchiving(null)}
      />
    </div>
  )
}
