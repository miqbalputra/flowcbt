// Daftar ujian (FR-5): status draft/published, token, tombol ujian baru
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { toast } from '@/components/toast'
import { ConfirmDialog } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, SortHeader, StatusBadge, TableToolbar, sortRowsBy, type SortDir } from './ui'
import {  asDict, copyText, errMessage, fmtDateTime, fmtRp, unwrap, unwrapList, qRows } from './types'

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

  const list = useQuery({ queryKey: ['exams'], queryFn: () => unwrapList(api('/exams')) })
  const rows = qRows(list)
  const sortedRows = sort
    ? sortRowsBy(rows, r => Date.parse(String(r.open_at ?? '')) || NaN, sort, true)
    : rows

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
      if (token) await copyText(token, 'Token ujian disalin 📋')
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
    void copyText(t, 'Token disalin 📋')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ujian"
        desc="Jadwalkan paket soal menjadi sesi ujian."
        action={<button type="button" className="btn-primary" onClick={() => nav('/exams/new')}>＋ Ujian Baru</button>}
      />

      <TableToolbar count={rows.length} label="ujian" />

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={5} />
      ) : list.isError ? (
        <ErrorBox error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon="📝" title="Belum ada ujian" children="Klik ＋ Ujian Baru untuk menjadwalkan paket soal." />
      ) : (
        <div className="overflow-x-auto lg:overflow-visible">
          <table className="table-base responsive-table">
            <thead>
              <tr>
                <th>Nama ujian</th>
                <th>Mapel</th>
                <th aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <SortHeader label="Dibuka" active={!!sort} dir={sort ?? 'asc'} onClick={toggleDateSort} />
                </th>
                <th>Token</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => {
                const isPublished = String(r.status ?? '') === 'published'
                return (
                  <tr key={r.id ?? i}>
                    <td data-th="Nama" className="font-medium">
                      <button type="button" className="text-primary hover:underline" onClick={() => nav(`/exams/${r.id}`)}>
                        {String(r.name ?? '—')}
                      </button>
                    </td>
                    <td data-th="Mapel">{String(r.subject_name ?? '—')}</td>
                    <td data-th="Dibuka" className="whitespace-nowrap">{fmtDateTime(r.open_at)}</td>
                    <td data-th="Token">
                      {typeof r.token === 'string' && r.token ? (
                        <button type="button" className="btn-ghost btn-sm font-mono"
                          onClick={() => copyToken(r.token as string)} title="Salin token">
                          {r.token}
                        </button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                      {typeof r.exam_code === 'string' && r.exam_code ? (
                        <div className="text-xs text-muted">Kode: <b className="font-mono">{r.exam_code}</b></div>
                      ) : null}
                    </td>
                    <td data-th="Status"><StatusBadge status={r.status} /></td>
                    <td data-th="Aksi">
                      <div className="flex gap-1.5 flex-wrap">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => nav(`/exams/${r.id}`)}>Detail</button>
                        {isPublished
                          ? <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void unpublish(r)}>Unpublish</button>
                          : <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => setPublishing(r)}>Publish</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!publishing}
        title="Publish ujian?"
        message="Ujian terlihat siswa sesuai jadwal, token aktif, dan soal terkunci (versioning)."
        busy={busy} confirmLabel="Ya, publish"
        onConfirm={publish}
        onClose={() => setPublishing(null)}
      />
    </div>
  )
}

