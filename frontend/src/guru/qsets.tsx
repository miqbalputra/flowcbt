// Daftar paket soal (FR-4.1): status, edit/duplikat/arsip/export, tombol baru
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, StatusBadge } from './ui'
import {  asDict, asList, errMessage, qs, qtypeLabel, statusBadge, unwrap, unwrapList, qRows } from './types'
import { downloadFile } from './files'

export default function Qsets() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [archiving, setArchiving] = useState<{ id: string; title: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useQuery({
    queryKey: ['question-sets', status, q],
    queryFn: () => unwrapList(api(`/question-sets${qs({ status: status || undefined, q: q || undefined })}`)),
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
          level_tags: src.level_tags,
        }), 'POST'))
      const setId = String(asDict(created).id ?? '')
      // salin per soal (kontrak API: 1 endpoint per soal)
      for (const question of asList(src.questions ?? [])) {
        const questionData = asDict(question)
        const { id: _omit, ...payload } = questionData
        void _omit
        await send(`/question-sets/${setId}/questions`, payload, 'POST')
      }
      toast('Paket soal diduplikasi 📄', 'success')
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
      toast('Paket diarsipkan 📦', 'success')
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
      toast('Paket soal diunduh ⬇️', 'success')
    } catch (err) {
      toast(errMessage(err), 'error')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Paket Soal"
        desc="Bank soal AKM: pilihan ganda, kompleks, menjodohkan, isian, uraian."
        action={<button type="button" className="btn-primary" onClick={() => nav('/question-sets/new/edit')}>＋ Paket Baru</button>}
      />

      <div className="card flex flex-col sm:flex-row gap-2 sm:items-center">
        <select className="input sm:max-w-44" value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter status">
          <option value="">Semua status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Arsip</option>
        </select>
        <input className="input" type="search" aria-label="Cari paket soal" placeholder="🔍 Cari judul / mapel / kode…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={5} />
      ) : list.isError ? (
        <ErrorBox error={list.error} />
      ) : qRows(list).length === 0 ? (
        <EmptyState icon="📚" title="Belum ada paket soal" children="Klik ＋ Paket Baru untuk mulai menulis soal." />
      ) : (
        <table className="table-base responsive-table">
          <thead>
            <tr><th>Judul</th><th>Mapel</th><th>Soal</th><th>Kode ujian</th><th>Status</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {qRows(list).map((r, i) => (
              <tr key={r.id ?? i}>
                <td data-th="Judul" className="font-medium">
                  <button type="button" className="text-primary hover:underline" onClick={() => nav(`/question-sets/${r.id}/edit`)}>
                    {String(r.title ?? '—')}
                  </button>
                  {Boolean(r.description) && <div className="text-xs text-muted line-clamp-1 max-w-64">{String(r.description)}</div>}
                </td>
                <td data-th="Mapel">{String(r.subject_name ?? r.subject ?? '—')}</td>
                <td data-th="Soal">{String(r.questions_count ?? (Array.isArray(r.questions) ? r.questions.length : 0))}</td>
                <td data-th="Kode" className="font-mono text-xs">{String(r.exam_code ?? '—')}</td>
                <td data-th="Status"><StatusBadge status={r.status} /></td>
                <td data-th="Aksi">
                  <div className="flex gap-1.5 flex-wrap">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => nav(`/question-sets/${r.id}/edit`)}>Edit</button>
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void duplicate(r)}>Duplikat</button>
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setArchiving({ id: String(r.id ?? ''), title: String(r.title ?? '') })}>Arsip</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => void exportXlsx(r)}>Export</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
