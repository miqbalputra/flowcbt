// CRUD Kelas (FR-3.1): nama, tahun ajaran, wali kelas, arsip
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, StatusBadge, TableToolbar } from './ui'
import {  asDict, asList, errMessage, fmtDate, qs, unwrap, unwrapList, qRows } from './types'

const EMPTY = { name: '', year: '', teacher_name: '' }

export default function Classes() {
  const qc = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<{ id?: string } & typeof EMPTY | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useQuery({
    queryKey: ['classes', showArchived],
    queryFn: () => unwrapList(api(`/classes${qs(showArchived ? { include_archived: 1, status: 'archived' } : {})}`)),
  })

  function refresh() { void qc.invalidateQueries({ queryKey: ['classes'] }) }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.name.trim()) { toast('Nama kelas wajib diisi', 'error'); return }
    setBusy(true)
    const body: Record<string, unknown> = {
      name: editing.name.trim(),
      teacher_name: editing.teacher_name.trim() || undefined,
    }
    if (editing.year.trim()) body.year = editing.year.trim()
    try {
      if (editing.id) {
        await send(`/classes/${editing.id}`, body, 'PUT')
        toast('Kelas diperbarui ✅', 'success')
      } else {
        await send('/classes', body, 'POST')
        toast('Kelas ditambahkan 🎉', 'success')
      }
      setEditing(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleArchive(row: Record<string, any>) {
    const archived = Boolean(row.archived ?? row.status === 'archived')
    setBusy(true)
    try {
      await send(`/classes/${row.id}`, { archived: !archived }, 'PUT')
      toast(archived ? 'Kelas dikeluarkan dari arsip' : 'Kelas diarsipkan 📦', 'success')
      setDeleting(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function del() {
    if (!deleting) return
    setBusy(true)
    try {
      await api(`/classes/${deleting.id}`, { method: 'DELETE' })
      toast('Kelas dihapus', 'success')
      setDeleting(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const rows = qRows(list).filter(r => showArchived || !Boolean(r.archived ?? r.status === 'archived'))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kelas"
        desc="Kelola daftar kelas & wali kelas."
        action={<button type="button" className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>＋ Kelas</button>}
      />

      <TableToolbar count={rows.length} label="kelas">
        <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Tampilkan arsip
        </label>
      </TableToolbar>

      {list.isLoading ? (
        <SkeletonRows rows={3} cols={4} />
      ) : list.isError ? (
        <ErrorBox error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon="🏫" title="Belum ada kelas" children="Klik ＋ Kelas untuk membuat kelas pertama." />
      ) : (
        <div className="overflow-x-auto lg:overflow-visible">
          <table className="table-base responsive-table">
            <thead>
              <tr><th>Nama</th><th>Tahun ajaran</th><th>Wali kelas</th><th>Siswa</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  <td data-th="Nama" className="font-medium">{String(r.name ?? '—')}</td>
                  <td data-th="Tahun ajaran">{String(r.year ?? r.academic_year ?? '—')}</td>
                  <td data-th="Wali kelas">{String(r.teacher_name ?? r.homeroom_teacher ?? '—')}</td>
                  <td data-th="Siswa" className="font-mono">{String(r.student_count ?? r.students_count ?? 0)}</td>
                  <td data-th="Status">
                    {Boolean(r.archived ?? r.status === 'archived')
                      ? <StatusBadge status="archived" />
                      : <span className="badge bg-success-soft text-success">Aktif</span>}
                  </td>
                  <td data-th="Aksi">
                    <div className="flex gap-1.5 flex-wrap">
                      <button type="button" className="btn-ghost btn-sm"
                        onClick={() => setEditing({
                          id: String(r.id ?? ''),
                          name: String(r.name ?? ''),
                          year: String(r.year ?? r.academic_year ?? ''),
                          teacher_name: String(r.teacher_name ?? ''),
                        })}>Edit</button>
                      <button type="button" className="btn-ghost btn-sm"
                        onClick={() => toggleArchive(r)}>{Boolean(r.archived ?? r.status === 'archived') ? 'Buka arsip' : 'Arsip'}</button>
                      <button type="button" className="btn-danger btn-sm"
                        onClick={() => setDeleting({ id: String(r.id ?? ''), name: String(r.name ?? '') })}>Hapus</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit Kelas' : 'Kelas Baru'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>{editing?.id ? 'Simpan' : 'Tambah'}</button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="label" htmlFor="cls-name">Nama kelas</label>
            <input id="cls-name" className="input" required value={editing?.name ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, name: e.target.value } : f))} placeholder="X IPA 1" />
          </div>
          <div>
            <label className="label" htmlFor="cls-year">Tahun ajaran</label>
            <input id="cls-year" className="input" value={editing?.year ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, year: e.target.value } : f))} placeholder="2025/2026" />
          </div>
          <div>
            <label className="label" htmlFor="cls-tea">Wali kelas <span className="font-normal">(opsional)</span></label>
            <input id="cls-tea" className="input" value={editing?.teacher_name ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, teacher_name: e.target.value } : f))} placeholder="Nama wali kelas" />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`Hapus kelas "${deleting?.name}"? Data siswa di kelas ini tidak ikut terhapus.`}
        danger busy={busy}
        onConfirm={del}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
