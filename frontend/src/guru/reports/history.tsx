// Riwayat ujian terdahulu (FR-9.6..9.7): filter mapel/status/tanggal + pencarian bebas.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import {
  EmptyState, ErrorBox, PageHeader, Panel, SearchBox, SkeletonRows, StatusBadge, TableToolbar,
} from '../ui'
import { asDict, asList, fmtDateTime, qs, unwrap } from '../types'
import { IconChart2, IconExam, IconRefresh, IconSearch } from '@/components/icons'

export default function ReportsHistory() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const list = useQuery({
    queryKey: ['reports', 'history', q, subject, status, from, to],
    queryFn: async () => unwrap(await api(`/reports/history${qs({
      q: q || undefined,
      subject: subject || undefined,
      from: from || undefined,
      to: to || undefined,
      status: status || undefined,
    })}`)),
    placeholderData: prev => prev,
  })

  const rows = list.isError ? [] : asList(list.data)
  const subjects = (() => {
    const set = new Set<string>()
    for (const r of rows) {
      const s = String(r.subject_name ?? '')
      if (s) set.add(s)
    }
    return [...set]
  })()

  const hasFilter = Boolean(q || subject || status || from || to)
  function resetFilter() {
    setQ('')
    setSubject('')
    setStatus('')
    setFrom('')
    setTo('')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Arsip & Evaluasi"
        title="Riwayat Ujian"
        desc="Laporan ujian yang sudah selesai — klik baris untuk statistik lengkap."
        icon={<IconChart2 size={18} />}
        action={
          hasFilter ? (
            <button type="button" className="btn-quiet btn-sm" onClick={resetFilter}>
              <IconRefresh size={13} /> Reset filter
            </button>
          ) : undefined
        }
      />

      <Panel title="Filter Laporan" icon={<IconSearch size={15} />}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2">
            <span className="label">Cari bebas</span>
            <SearchBox
              value={q}
              onChange={setQ}
              label="Cari bebas"
              placeholder="Judul / kode / guru…"
            />
            <p className="hint mt-1">Judul ujian, kode, atau nama guru.</p>
          </div>
          <div>
            <label className="label" htmlFor="h-sub">Mapel</label>
            <select id="h-sub" className="input" value={subject} onChange={e => setSubject(e.target.value)}>
              <option value="">Semua</option>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="hint mt-1">Dari hasil yang tampil.</p>
          </div>
          <div>
            <label className="label" htmlFor="h-from">Dari</label>
            <input id="h-from" type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
            <p className="hint mt-1">Tanggal buka ujian.</p>
          </div>
          <div>
            <label className="label" htmlFor="h-to">Sampai</label>
            <input id="h-to" type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
            <p className="hint mt-1">Batas akhir rentang.</p>
          </div>
          <div>
            <label className="label" htmlFor="h-st">Status</label>
            <select id="h-st" className="input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Semua</option>
              <option value="published">Terbit</option>
              <option value="archived">Diarsipkan</option>
            </select>
            <p className="hint mt-1">Status ujian di sistem.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Daftar Ujian" icon={<IconExam size={15} />} flush>
        <div className="border-b border-border p-3">
          <TableToolbar count={rows.length} label="ujian">
            <span className="text-xs text-muted">Klik baris untuk membuka laporan lengkap.</span>
          </TableToolbar>
        </div>

        {list.isLoading ? (
          <div className="p-3"><SkeletonRows rows={4} cols={5} /></div>
        ) : list.isError ? (
          <div className="p-3"><ErrorBox error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconExam />} title="Tidak ada ujian pada filter ini">
            Coba longgarkan rentang tanggal atau mapel.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Ujian</th>
                  <th scope="col">Mapel</th>
                  <th scope="col">Kelas</th>
                  <th scope="col">Tanggal</th>
                  <th scope="col" className="num">Rata-rata</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.exam_id ?? r.id ?? i}
                    className="cursor-pointer"
                    onClick={() => nav(`/reports/exams/${r.exam_id ?? r.id}`)}
                  >
                    <td data-th="Ujian">
                      <button type="button" className="btn-quiet btn-sm !px-0 text-left !text-primary">
                        {String(r.name ?? '—')}
                      </button>
                    </td>
                    <td data-th="Mapel" className="text-muted">{String(r.subject_name ?? '—')}</td>
                    <td data-th="Kelas">{asList(r.classes).map(c => asDict(c).name).filter(Boolean).join(', ') || '—'}</td>
                    <td data-th="Tanggal" className="whitespace-nowrap">{fmtDateTime(r.close_at ?? r.date ?? r.finished_at)}</td>
                    <td data-th="Rata-rata" className="num font-bold">{String(r.avg_score ?? r.avg ?? '—')}</td>
                    <td data-th="Status"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
