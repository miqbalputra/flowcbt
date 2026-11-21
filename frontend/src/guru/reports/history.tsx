// Riwayat ujian terdahulu (FR-9.6..9.7): filter mapel/status/tanggal + pencarian bebas.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, StatusBadge, TableToolbar } from '../ui'
import { asDict, asList, errMessage, fmtDateTime, qs, unwrap } from '../types'
import { IconChart2, IconExam } from '@/components/icons'

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

  return (
    <div className="space-y-4">
      <PageHeader title="Riwayat Ujian" desc="Laporan ujian yang sudah selesai — klik baris untuk statistik lengkap." icon={<IconChart2 size={18} />} />

      <div className="card grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="col-span-2">
          <label className="label" htmlFor="h-q">Cari bebas</label>
          <input id="h-q" className="input" placeholder="Judul / kode / guru…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="h-sub">Mapel</label>
          <select id="h-sub" className="input" value={subject} onChange={e => setSubject(e.target.value)}>
            <option value="">Semua</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="h-from">Dari</label>
          <input id="h-from" type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="h-to">Sampai</label>
          <input id="h-to" type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="h-st">Status</label>
          <select id="h-st" className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Semua</option>
            <option value="done">Selesai</option>
            <option value="published">Published</option>
            <option value="closed">Ditutup</option>
          </select>
        </div>
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={5} />
      ) : list.isError ? (
        <ErrorBox error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconExam />} title="Tidak ada ujian pada filter ini" children="Coba longgarkan rentang tanggal atau mapel." />
      ) : (
        <>
          <TableToolbar count={rows.length} label="ujian" />
          <div className="overflow-x-auto lg:overflow-visible">
            <table className="table-base responsive-table">
              <thead>
                <tr><th>Ujian</th><th>Mapel</th><th>Kelas</th><th>Tanggal</th><th>Rata-rata</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.exam_id ?? r.id ?? i}
                    className="cursor-pointer"
                    onClick={() => nav(`/reports/exams/${r.exam_id ?? r.id}`)}
                  >
                    <td data-th="Ujian" className="font-medium">
                      <button type="button" className="text-primary hover:underline text-left">{String(r.name ?? '—')}</button>
                    </td>
                    <td data-th="Mapel">{String(r.subject_name ?? '—')}</td>
                    <td data-th="Kelas">{asList(r.classes).map(c => asDict(c).name).filter(Boolean).join(', ') || '—'}</td>
                    <td data-th="Tanggal" className="whitespace-nowrap">{fmtDateTime(r.close_at ?? r.date ?? r.finished_at)}</td>
                    <td data-th="Rata-rata" className="font-mono font-bold">{String(r.avg_score ?? r.avg ?? '—')}</td>
                    <td data-th="Status"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
