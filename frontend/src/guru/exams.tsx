// Daftar ujian (FR-5): status draft/published, token, tombol ujian baru.
// Tampilan Design System v3 "Portal Ujian": kepala institusional, KPI ringkas,
// toolbar + tab status, tabel padat (mobile → kartu via .responsive-table).
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { toast } from '@/components/toast'
import { ConfirmDialog } from '@/components/modal'
import {
  Callout,
  EmptyState,
  ErrorBox,
  PageHeader,
  Panel,
  SearchBox,
  SkeletonRows,
  SortHeader,
  StatCard,
  StatusBadge,
  TableToolbar,
  Tabs,
  sortRowsBy,
  type SortDir,
} from './ui'
import { IconCheck, IconClock, IconCopy, IconEdit, IconExam, IconInfo, IconPlus } from '@/components/icons'
import { asDict, copyText, errMessage, fmtDateTime, qRows, unwrap, unwrapList } from './types'

export default function Exams() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [busyFor, setBusyFor] = useState<Record<string, any> | null>(null)
  const [publishing, setPublishing] = useState<Record<string, any> | null>(null)
  // sort kolom Tanggal (Dibuka): asc → desc → netral — hanya halaman aktif
  const [sort, setSort] = useState<SortDir | null>(null)
  function toggleDateSort() {
    setSort(prev => (prev === null ? 'asc' : prev === 'asc' ? 'desc' : null))
  }
  const busy = busyFor !== null

  // filter tampilan (tidak mengubah query): pencarian + tab status
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')

  const list = useQuery({ queryKey: ['exams'], queryFn: async () => unwrapList(await api('/exams')) })
  const rows = qRows(list)

  const published = rows.filter(r => String(r.status ?? '') === 'published')
  const drafts = rows.filter(r => String(r.status ?? '') === 'draft')
  const archived = rows.filter(r => String(r.status ?? '') === 'archived')
  const now = Date.now()
  const scheduled = published.filter(r => {
    const t = Date.parse(String(r.open_at ?? ''))
    return Number.isFinite(t) && t > now
  })

  const tabs = [
    { key: 'all', label: 'Semua', count: rows.length },
    { key: 'published', label: 'Terbit', count: published.length },
    { key: 'draft', label: 'Draf', count: drafts.length },
    ...(archived.length > 0 || tab === 'archived' ? [{ key: 'archived', label: 'Arsip', count: archived.length }] : []),
  ]

  const keyword = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (tab !== 'all' && String(r.status ?? '') !== tab) return false
    if (!keyword) return true
    return [r.name, r.subject_name, r.exam_code, r.token]
      .some(v => String(v ?? '').toLowerCase().includes(keyword))
  })
  const sortedRows = sort
    ? sortRowsBy(filtered, r => Date.parse(String(r.open_at ?? '')) || NaN, sort, true)
    : filtered

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['exams'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function publish() {
    if (!publishing) return
    setBusyFor(publishing)
    try {
      const res = unwrap(await api(`/exams/${publishing.id}/publish`, { method: 'POST' }))
      const d = asDict(res)
      const token = String(d.token ?? '')
      if (token) await copyText(token, 'Token ujian disalin')
      toast(`Ujian dipublish! Kode ujian: ${String(d.exam_code || '—')}`, 'success')
      setPublishing(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusyFor(null)
    }
  }

  async function unpublish(row: Record<string, any>) {
    setBusyFor(row)
    try {
      await api(`/exams/${row.id}/unpublish`, { method: 'POST' })
      toast('Ujian kembali ke draft — tidak terlihat siswa', 'success')
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusyFor(null)
    }
  }

  function copyToken(t: string) {
    void copyText(t, 'Token disalin')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Akademik · Ujian"
        title="Ujian"
        desc="Jadwalkan paket soal menjadi sesi ujian."
        icon={<IconExam size={18} />}
        action={
          <button type="button" className="btn-primary" onClick={() => nav('/exams/new')}>
            <IconPlus size={16} /> Ujian Baru
          </button>
        }
      />

      {/* KPI ringkas dari daftar yang sama */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {list.isLoading ? (
          <div className="col-span-2 lg:col-span-4"><SkeletonRows rows={2} cols={4} /></div>
        ) : list.isError ? null : (
          <>
            <StatCard
              label="Total ujian"
              value={String(rows.length)}
              hint="seluruh sesi dibuat"
              icon={<IconExam size={14} />}
            />
            <StatCard
              label="Terbit"
              value={String(published.length)}
              hint="terlihat oleh siswa"
              tone="success"
              icon={<IconCheck size={14} />}
            />
            <StatCard
              label="Draf"
              value={String(drafts.length)}
              hint="belum diterbitkan"
              icon={<IconEdit size={14} />}
            />
            <StatCard
              label="Terjadwal"
              value={String(scheduled.length)}
              hint="menunggu waktu buka"
              tone="primary"
              icon={<IconClock size={14} />}
            />
          </>
        )}
      </div>

      {drafts.length > 0 && (
        <Callout tone="info" title="Draf belum terlihat siswa" icon={<IconInfo size={16} />}>
          <span className="mono font-semibold">{drafts.length}</span> ujian masih draft — publish agar token aktif
          dan peserta bisa mulai sesuai jadwal.
        </Callout>
      )}

      <Panel
        title="Daftar Ujian"
        icon={<IconExam size={15} />}
        action={<span className="chip mono">{rows.length}</span>}
        flush
      >
        <div className="border-b border-border p-3">
          <TableToolbar count={filtered.length} label="ujian">
            <SearchBox
              className="w-full sm:w-64"
              label="Cari ujian, mapel, kode, atau token"
              placeholder="Cari ujian / kode…"
              value={search}
              onChange={setSearch}
            />
          </TableToolbar>
        </div>

        <Tabs items={tabs} value={tab} onChange={setTab} ariaLabel="Filter status ujian" />

        {list.isLoading ? (
          <div className="p-3"><SkeletonRows rows={4} cols={4} /></div>
        ) : list.isError ? (
          <div className="p-3"><ErrorBox error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconExam size={20} />} title="Belum ada ujian">
            {'Klik tombol "Ujian Baru" untuk menjadwalkan paket soal.'}
          </EmptyState>
        ) : sortedRows.length === 0 ? (
          <EmptyState icon={<IconExam size={20} />} title="Tidak ada ujian yang cocok">
            Ubah kata kunci pencarian atau pilih tab status lain.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Nama ujian</th>
                  <th scope="col">Mapel</th>
                  <th scope="col" aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <SortHeader label="Dibuka" active={!!sort} dir={sort ?? 'asc'} onClick={toggleDateSort} />
                  </th>
                  <th scope="col">Token</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => {
                  const isPublished = String(r.status ?? '') === 'published'
                  return (
                    <tr key={r.id ?? i}>
                      <td data-th="Nama ujian" className="font-medium">
                        <button
                          type="button"
                          className="block max-w-[16rem] truncate text-left font-semibold text-primary hover:underline"
                          onClick={() => nav(`/exams/${r.id}`)}
                        >
                          {String(r.name ?? '—')}
                        </button>
                      </td>
                      <td data-th="Mapel" className="text-muted">{String(r.subject_name ?? '—')}</td>
                      <td data-th="Dibuka" className="mono whitespace-nowrap text-xs">
                        {fmtDateTime(r.open_at)}
                      </td>
                      <td data-th="Token">
                        <div className="space-y-0.5">
                          {typeof r.token === 'string' && r.token ? (
                            <button
                              type="button"
                              className="btn-quiet btn-sm mono"
                              onClick={() => copyToken(r.token as string)}
                              title="Salin token"
                            >
                              <IconCopy size={12} /> {r.token}
                            </button>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                          {typeof r.exam_code === 'string' && r.exam_code ? (
                            <div className="text-xs text-muted">
                              Kode: <b className="mono font-semibold">{r.exam_code}</b>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td data-th="Status"><StatusBadge status={r.status} /></td>
                      <td data-th="Aksi">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" className="btn-quiet btn-sm" onClick={() => nav(`/exams/${r.id}`)}>
                            Detail
                          </button>
                          {isPublished ? (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => void unpublish(r)}
                            >
                              Tarik
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => setPublishing(r)}
                            >
                              <IconCheck size={13} /> Terbitkan
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={!!publishing}
        title="Publish ujian?"
        message="Ujian terlihat siswa sesuai jadwal, token aktif, dan soal terkunci (versioning)."
        busy={busy}
        confirmLabel="Ya, publish"
        onConfirm={publish}
        onClose={() => setPublishing(null)}
      />
    </div>
  )
}
