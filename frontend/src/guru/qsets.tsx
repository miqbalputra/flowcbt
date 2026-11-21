// Daftar paket soal (FR-4.1): status, edit/duplikat/arsip/export, tombol baru
import { useState } from 'react'
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
import { IconBank, IconCheck, IconClipboard, IconCopy, IconDownload, IconEdit, IconPlus, IconTrash } from '@/components/icons'
import { asDict, asList, errMessage, qs, qRows, unwrap, unwrapList } from './types'
import { downloadFile } from './files'

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
          <TableToolbar count={rows.length} label="paket">
            <SearchBox
              className="w-full sm:w-72"
              label="Cari paket soal"
              placeholder="Cari judul / mapel / kode…"
              value={q}
              onChange={setQ}
            />
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
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Judul</th>
                  <th scope="col">Mapel</th>
                  <th scope="col" className="num">Soal</th>
                  <th scope="col">Kode soal</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? i}>
                    <td data-th="Judul">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="block max-w-[22rem] truncate text-left font-semibold text-primary hover:underline"
                          onClick={() => nav(`/question-sets/${r.id}/edit`)}
                        >
                          {String(r.title ?? '—')}
                        </button>
                        {Boolean(r.description) && (
                          <div className="mt-0.5 max-w-[22rem] truncate text-xs text-muted">{String(r.description)}</div>
                        )}
                      </div>
                    </td>
                    <td data-th="Mapel" className="text-muted">{String(r.subject_name ?? r.subject ?? '—')}</td>
                    <td data-th="Soal" className="num">{String(itemCount(r))}</td>
                    <td data-th="Kode soal" className="mono text-xs">{String(r.exam_code ?? '—')}</td>
                    <td data-th="Status"><StatusBadge status={r.status} /></td>
                    <td data-th="Aksi">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => nav(`/question-sets/${r.id}/edit`)}
                        >
                          <IconEdit size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => void duplicate(r)}
                        >
                          <IconCopy size={13} /> Duplikat
                        </button>
                        <button
                          type="button"
                          className="btn-quiet btn-sm"
                          disabled={busy}
                          onClick={() => setArchiving({ id: String(r.id ?? ''), title: String(r.title ?? '') })}
                        >
                          <IconTrash size={13} /> Arsip
                        </button>
                        <button type="button" className="btn-quiet btn-sm" onClick={() => void exportXlsx(r)}>
                          <IconDownload size={13} /> Export
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
