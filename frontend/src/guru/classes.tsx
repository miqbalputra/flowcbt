// CRUD Kelas (FR-3.1): nama, tahun ajaran, wali kelas, arsip — tampilan grid kartu.
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import {
  EmptyState, ErrorBox, PageHeader, Panel, SkeletonRows, StatCard, StatusBadge, TableToolbar, Tabs,
} from './ui'
import { IconClass, IconPlus, IconStudents } from '@/components/icons'
import { errMessage, fmtDate, qs, unwrapList, qRows } from './types'

const EMPTY = { name: '', year: '', teacher_name: '' }

const isArchived = (r: Record<string, any>) => Boolean(r.archived ?? r.status === 'archived')

export default function Classes() {
  const qc = useQueryClient()
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<{ id?: string } & typeof EMPTY | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useQuery({
    queryKey: ['classes', showArchived],
    queryFn: async () => unwrapList(await api(`/classes${qs(showArchived ? { include_archived: 1, status: 'archived' } : {})}`)),
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
        toast('Kelas diperbarui', 'success')
      } else {
        await send('/classes', body, 'POST')
        toast('Kelas ditambahkan', 'success')
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
    const archived = isArchived(row)
    setBusy(true)
    try {
      await send(`/classes/${row.id}`, { archived: !archived }, 'PUT')
      toast(archived ? 'Kelas dikeluarkan dari arsip' : 'Kelas diarsipkan', 'success')
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

  const allRows = qRows(list)
  const rows = allRows.filter(r => showArchived || !isArchived(r))
  const activeCount = allRows.filter(r => !isArchived(r)).length
  const studentTotal = allRows.reduce((sum, r) => sum + (Number(r.student_count ?? r.students_count ?? 0) || 0), 0)
  const avgPerClass = activeCount > 0 ? Math.round(studentTotal / activeCount) : 0
  const statsReady = !list.isLoading && !list.isError

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Struktur Akademik"
        title="Kelas"
        desc="Kelola daftar kelas, tahun ajaran, dan wali kelas."
        icon={<IconClass size={18} />}
        action={
          <button type="button" className="btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY })}>
            <IconPlus size={14} /> Kelas baru
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
        <StatCard
          label="Kelas aktif"
          value={statsReady ? String(activeCount) : '—'}
          hint="tidak diarsipkan"
          tone="primary"
          icon={<IconClass size={14} />}
        />
        <StatCard
          label="Total siswa"
          value={statsReady ? String(studentTotal) : '—'}
          hint="terdaftar di semua kelas"
          icon={<IconStudents size={14} />}
        />
        <StatCard
          label="Rata-rata per kelas"
          value={statsReady ? String(avgPerClass) : '—'}
          hint="siswa di kelas aktif"
          tone="success"
          icon={<IconStudents size={14} />}
        />
      </div>

      <Panel
        title="Daftar kelas"
        icon={<IconClass size={15} />}
        flush
        footer={
          <span className="text-xs text-muted">
            <span className="mono font-semibold text-text">{rows.length}</span> kelas ditampilkan
            {showArchived ? ' termasuk arsip' : ' — arsip disembunyikan'}
          </span>
        }
      >
        <div className="border-b border-border p-3">
          <TableToolbar count={rows.length} label="kelas" />
        </div>

        <Tabs
          ariaLabel="Filter arsip kelas"
          items={[
            { key: 'active', label: 'Kelas aktif' },
            { key: 'all', label: 'Dengan arsip' },
          ]}
          value={showArchived ? 'all' : 'active'}
          onChange={key => setShowArchived(key === 'all')}
        />

        {list.isLoading ? (
          <div className="p-3">
            <SkeletonRows rows={3} cols={3} />
          </div>
        ) : list.isError ? (
          <div className="p-3">
            <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconClass size={20} />} title="Belum ada kelas">
            Klik tombol "Kelas baru" di kanan atas untuk membuat kelas pertama.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r, i) => {
              const archived = isArchived(r)
              const name = String(r.name ?? '—')
              const year = String(r.year ?? r.academic_year ?? '—')
              const teacher = String(r.teacher_name ?? r.homeroom_teacher ?? '—')
              const students = String(r.student_count ?? r.students_count ?? 0)
              const created = r.created_at ? fmtDate(r.created_at) : ''
              return (
                <article key={r.id ?? i} className="flex flex-col rounded-md border border-border bg-surface">
                  <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <h3 className="truncate text-[13.5px] font-bold leading-tight" title={name}>{name}</h3>
                      <p className="mono mt-0.5 truncate text-[11px] text-muted">{year}</p>
                    </div>
                    {archived
                      ? <StatusBadge status="archived" />
                      : <span className="badge border border-success-line bg-success-soft text-success">Aktif</span>}
                  </header>

                  <dl className="flex-1 space-y-1.5 px-3 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-xs text-muted">Wali kelas</dt>
                      <dd className="min-w-0 truncate text-right font-medium" title={teacher}>{teacher}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-xs text-muted">Siswa</dt>
                      <dd className="mono text-right font-semibold">{students}</dd>
                    </div>
                    {created && (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-xs text-muted">Dibuat</dt>
                        <dd className="mono text-right text-xs text-muted">{created}</dd>
                      </div>
                    )}
                  </dl>

                  <footer className="flex flex-wrap items-center gap-1.5 border-t border-border bg-canvas px-2.5 py-2">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setEditing({
                        id: String(r.id ?? ''),
                        name: String(r.name ?? ''),
                        year: String(r.year ?? r.academic_year ?? ''),
                        teacher_name: String(r.teacher_name ?? ''),
                      })}
                    >
                      Edit
                    </button>
                    <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => void toggleArchive(r)}>
                      {archived ? 'Buka arsip' : 'Arsip'}
                    </button>
                    <button
                      type="button"
                      className="btn-quiet btn-sm ml-auto"
                      onClick={() => setDeleting({ id: String(r.id ?? ''), name: String(r.name ?? '') })}
                    >
                      Hapus
                    </button>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </Panel>

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
            <input
              id="cls-name"
              className="input"
              required
              value={editing?.name ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, name: e.target.value } : f))}
              placeholder="X IPA 1"
            />
          </div>
          <div>
            <label className="label" htmlFor="cls-year">Tahun ajaran</label>
            <input
              id="cls-year"
              className="input mono"
              value={editing?.year ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, year: e.target.value } : f))}
              placeholder="2025/2026"
            />
            <p className="hint mt-1">Format tahun ajaran, contoh 2025/2026.</p>
          </div>
          <div>
            <label className="label" htmlFor="cls-tea">
              Wali kelas <span className="font-normal text-muted">(opsional)</span>
            </label>
            <input
              id="cls-tea"
              className="input"
              value={editing?.teacher_name ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, teacher_name: e.target.value } : f))}
              placeholder="Nama wali kelas"
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`Hapus kelas "${deleting?.name}"? Data siswa di kelas ini tidak ikut terhapus.`}
        danger
        busy={busy}
        onConfirm={del}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
