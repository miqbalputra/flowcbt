// Daftar siswa (FR-3.2..3.4): CRUD, filter kelas, pencarian, import wizard, export, kuota.
// Tampilan Design System v3 "Portal Ujian": PageHeader + Panel, toolbar tabel, aksi massal.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import {
  Callout, EmptyState, ErrorBox, PageHeader, Panel, ProgressBar, SearchBox,
  SkeletonRows, SortHeader, TableToolbar, sortRowsBy, type SortDir,
} from './ui'
import { IconCheck, IconCopy, IconDownload, IconPlus, IconStudents, IconUpload, IconWarn } from '@/components/icons'
import { asDict, asList, asDict as d, errCode, errMessage, GENDERS, qNext, qRows, qs, unwrap, unwrapList } from './types'
import { apiUrl, uploadFile } from './files'
import { getAccessToken } from '@/lib/api'

const PAGE = 25
const EMPTY = { full_name: '', gender: 'L', class_id: '', nis: '', birth_place: '', birth_date: '', phone: '', parent_phone: '' }

/* ------------------------- import wizard: stepper ------------------------- */

const IMPORT_STEPS: { key: 'upload' | 'preview' | 'done'; label: string }[] = [
  { key: 'upload', label: 'Berkas' },
  { key: 'preview', label: 'Pratinjau' },
  { key: 'done', label: 'Kartu login' },
]

function ImportSteps({ current }: { current: 'upload' | 'preview' | 'done' }) {
  const idx = IMPORT_STEPS.findIndex(s => s.key === current)
  return (
    <ol className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3" aria-label="Langkah import">
      {IMPORT_STEPS.map((s, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`mono flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                active
                  ? 'border-primary bg-primary text-white'
                  : done
                    ? 'border-success-line bg-success-soft text-success'
                    : 'border-border bg-canvas text-muted'
              }`}
            >
              {done ? <IconCheck size={12} /> : i + 1}
            </span>
            <span className={`text-xs ${active ? 'font-semibold text-text' : 'text-muted'}`}>{s.label}</span>
            {i < IMPORT_STEPS.length - 1 && <span aria-hidden className="mx-0.5 h-px w-5 bg-border-strong" />}
          </li>
        )
      })}
    </ol>
  )
}

/* --------------------------------- halaman -------------------------------- */

export default function Students() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()

  const [classId, setClassId] = useState(params.get('class_id') ?? '')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(search)
  const [cursor, setCursor] = useState<string | null>(null)
  const [editing, setEditing] = useState<null | ({ id?: string } & typeof EMPTY)>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null)
  const [newPass, setNewPass] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(params.get('import') === '1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 350)
    return () => window.clearTimeout(t)
  }, [search])
  useEffect(() => { setCursor(null) }, [classId, debounced])

  const classes = useQuery({ queryKey: ['classes'], queryFn: async () => unwrapList(await api('/classes')) })
  const list = useQuery({
    queryKey: ['students', classId, debounced, cursor],
    queryFn: async () => unwrapList(await api(`/students${qs({ class_id: classId || undefined, q: debounced || undefined, limit: PAGE, cursor: cursor || undefined })}`)),
    placeholderData: prev => prev,
  })

  // ---- sort tabel (klik header: asc → desc → netral; hanya halaman aktif, directive §3A) ----
  type SortKey = 'name' | 'kelas'
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null)
  function toggleSort(key: SortKey) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  // ---- batch selection (checkbox per baris; hanya halaman aktif) ----
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const rows = qRows(list)
  const pageIds = rows.map(r => String(r.id ?? '')).filter(Boolean)
  const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id))
  const headCheckRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headCheckRef.current) headCheckRef.current.indeterminate = selected.size > 0 && !allSelected
  }, [selected, allSelected])
  // seleksi terikat halaman aktif → kosongkan saat data halaman berganti (filter/cari/muat)
  useEffect(() => { setSelected(new Set()) }, [list.data])

  function toggleRow(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function toggleAllRows() {
    setSelected(allSelected ? new Set() : new Set(pageIds))
  }

  // ---- aksi massal: pindah kelas & hapus — loop per siswa; satu gagal TIDAK menghentikan sisanya ----
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveProg, setMoveProg] = useState({ done: 0, total: 0, fail: 0 })
  const [delBatchOpen, setDelBatchOpen] = useState(false)
  const [delProg, setDelProg] = useState({ done: 0, total: 0, fail: 0 })

  async function doMoveClass() {
    if (!moveTarget) { toast('Pilih kelas tujuan dulu', 'error'); return }
    const ids = [...selected]
    setMoveBusy(true)
    setMoveProg({ done: 0, total: ids.length, fail: 0 })
    let fail = 0
    for (let i = 0; i < ids.length; i++) {
      try {
        await send(`/students/${ids[i]}`, { class_id: moveTarget }, 'PUT')
      } catch {
        fail++ // lanjutkan sisanya walau ada yang gagal
      }
      setMoveProg({ done: i + 1, total: ids.length, fail })
      if ((i + 1) % 5 === 0) toast(`Memindahkan… ${i + 1}/${ids.length}`, 'info')
    }
    setMoveBusy(false)
    setMoveOpen(false)
    setSelected(new Set())
    if (fail === 0) toast(`${ids.length} siswa dipindahkan`, 'success')
    else toast(`Selesai: ${ids.length - fail} berhasil, ${fail} gagal`, fail > 0 && ids.length - fail === 0 ? 'error' : 'warn')
    refresh()
  }

  async function doBatchDelete() {
    const ids = [...selected]
    setBusy(true)
    setDelProg({ done: 0, total: ids.length, fail: 0 })
    let fail = 0
    for (let i = 0; i < ids.length; i++) {
      try {
        await api(`/students/${ids[i]}`, { method: 'DELETE' })
      } catch {
        fail++
      }
      setDelProg({ done: i + 1, total: ids.length, fail })
      if ((i + 1) % 5 === 0) toast(`Menghapus… ${i + 1}/${ids.length}`, 'info')
    }
    setBusy(false)
    setDelBatchOpen(false)
    setSelected(new Set())
    if (fail === 0) toast(`${ids.length} siswa dihapus`, 'success')
    else toast(`Selesai: ${ids.length - fail} berhasil, ${fail} gagal`, fail > 0 && ids.length - fail === 0 ? 'error' : 'warn')
    refresh()
  }

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['students'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // ---------- import wizard ----------
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [preview, setPreview] = useState<{ rows: Record<string, any>[]; summary?: Record<string, any> } | null>(null)
  const [createdLogins, setCreatedLogins] = useState<{ username: string; temp_pass: string }[]>([])
  const [quotaExceeded, setQuotaExceeded] = useState(false)

  const rowProblem = (r: Record<string, any>): string => {
    if (Array.isArray(r.errors) && r.errors.length) return r.errors.map((e: any) => (typeof e === 'string' ? e : String(e?.message ?? ''))).join('; ')
    if (r.valid === false) return String(r.message ?? r.error_message ?? 'Baris tidak valid')
    if (!String(r.full_name ?? r.name ?? '').trim()) return 'Nama kosong'
    const g = String(r.gender ?? '').trim().toUpperCase()
    if (g !== 'L' && g !== 'P') return 'Jenis kelamin harus L atau P'
    if (!String(r.class_name ?? r.class_id ?? '').trim()) return 'Kelas belum terisi'
    if (Array.isArray(r.warnings) && r.warnings.length) return r.warnings.map((w: any) => String(typeof w === 'string' ? w : w?.message ?? '')).join('; ')
    return ''
  }

  async function onUploadFile(f: File | null) {
    if (!f) return
    setBusy(true)
    try {
      const res = await uploadFile('/students/import/preview', f)
      const d = asDict(res.data ?? res)
      setPreview({ rows: asList(d.rows ?? d.data ?? d), summary: asDict(d.summary) })
      setStep('preview')
    } catch (err) {
      if (errCode(err) === 'QUOTA_EXCEEDED') setQuotaExceeded(true)
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function commitImport() {
    if (!preview) return
    setBusy(true)
    try {
      const res = unwrap(await send('/students/import/commit', { rows: preview.rows }, 'POST'))
      const dd = asDict(res)
      const logins = asList(dd.logins ?? dd.accounts ?? dd.created ?? [])
        .map(r => asDict(r))
        .map(r => ({
          username: String(r.username ?? r.student_code ?? '—'),
          temp_pass: String(r.temp_password ?? r.temp_pass ?? r.password ?? '—'),
        }))
      setCreatedLogins(logins)
      setStep('done')
      toast(`${dd.created_count ?? preview.rows.length} siswa diimport`, 'success')
      refresh()
    } catch (err) {
      if (errCode(err) === 'QUOTA_EXCEEDED') setQuotaExceeded(true)
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function closeImport() {
    setImportOpen(false)
    setStep('upload'); setPreview(null); setCreatedLogins([]); setQuotaExceeded(false)
  }

  // ---------- CRUD ----------
  /** Buka modal edit dengan data lengkap (list tak memuat data lahir & HP). */
  async function openEdit(id: string) {
    try {
      const d = unwrap(await api(`/students/${id}`))
      setEditing({
        id,
        full_name: String(d.full_name ?? d.name ?? ''),
        gender: String(d.gender ?? 'L').toUpperCase() === 'P' ? 'P' : 'L',
        class_id: String(d.class_id ?? ''),
        nis: String(d.nis ?? ''),
        birth_place: String(d.birth_place ?? ''),
        birth_date: String(d.birth_date ?? ''),
        phone: String(d.phone ?? ''),
        parent_phone: String(d.parent_phone ?? ''),
      })
    } catch (err) {
      toast(errMessage(err), 'error')
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.full_name.trim()) { toast('Nama siswa wajib diisi', 'error'); return }
    setBusy(true)
    const body: Record<string, unknown> = {
      name: editing.full_name.trim(),
      gender: editing.gender,
      birth_place: editing.birth_place.trim(),
      phone: editing.phone.trim(),
      parent_phone: editing.parent_phone.trim(),
    }
    if (editing.class_id) body.class_id = editing.class_id
    if (editing.nis.trim()) body.nis = editing.nis.trim()
    // tanggal harus YYYY-MM-DD; kosong = hapus
    if (/^\d{4}-\d{2}-\d{2}$/.test(editing.birth_date)) body.birth_date = editing.birth_date
    try {
      if (editing.id) {
        await send(`/students/${editing.id}`, body, 'PUT')
        toast('Data siswa diperbarui', 'success')
      } else {
        await send('/students', body, 'POST')
        toast('Siswa ditambahkan', 'success')
      }
      setEditing(null)
      refresh()
    } catch (err) {
      if (errCode(err) === 'QUOTA_EXCEEDED') { setEditing(null); setQuotaExceeded(true) }
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function del() {
    if (!deleting) return
    setBusy(true)
    try {
      await api(`/students/${deleting.id}`, { method: 'DELETE' })
      toast('Siswa dihapus', 'success')
      setDeleting(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resetPass() {
    if (!resetting) return
    setBusy(true)
    try {
      const res = unwrap(await api(`/students/${resetting.id}/reset-password`, { method: 'POST' }))
      const rd = asDict(res)
      setNewPass(String(rd.new_password ?? rd.temp_password ?? rd.password ?? '—'))
      setResetting(null)
      toast('Password baru dibuat', 'success')
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copyLogin(text: string, msg = 'Kartu login disalin') {
    try {
      await navigator.clipboard.writeText(text)
      toast(msg, 'success')
    } catch {
      toast('Gagal menyalin — salin manual ya', 'error')
    }
  }

  const classOptions = classes.isError ? [] : classes.data ? classes.data.rows : []
  const validCount = preview ? preview.rows.filter(r => !rowProblem(d(r))).length : 0
  const problemCount = preview ? preview.rows.filter(r => !!rowProblem(d(r))).length : 0

  const shown = sort
    ? sortRowsBy(rows, r => (sort.key === 'name' ? (r.full_name ?? r.name) : r.class_name), sort.dir)
    : rows

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Data Akademik"
        title="Siswa"
        desc="Kelola data siswa, import massal, dan bagikan kartu login."
        icon={<IconStudents size={18} />}
        action={
          <>
            <a
              className="btn-ghost btn-sm"
              href={apiUrl(`/students/export${qs({ class_id: classId || undefined, format: 'xlsx' })}`)}
              onClick={e => { if (!getAccessToken()) { e.preventDefault(); toast('Harus masuk dulu untuk export', 'error') } }}
              target="_blank"
              rel="noopener"
              title="Unduh .xlsx"
            >
              <IconDownload size={14} /> XLSX
            </a>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setImportOpen(true)}>
              <IconUpload size={14} /> Import
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY })}>
              <IconPlus size={14} /> Siswa
            </button>
          </>
        }
      />

      {quotaExceeded && (
        <Callout tone="warn" title="Kuota siswa habis" icon={<IconWarn size={16} />}>
          <p>Jumlah siswa sudah mencapai batas paket Anda. Tingkatkan paket untuk menambah siswa.</p>
          <button type="button" className="btn-primary btn-sm mt-2" onClick={() => nav('/billing')}>
            Tingkatkan paket
          </button>
        </Callout>
      )}

      <Panel
        title="Daftar siswa"
        icon={<IconStudents size={15} />}
        flush
        footer={
          qNext(list) ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted">
                Menampilkan <span className="mono font-semibold text-text">{rows.length}</span> siswa pada halaman ini
              </span>
              <button type="button" className="btn-ghost" onClick={() => setCursor(qNext(list))}>
                Muat lebih banyak
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="border-b border-border p-3">
          <TableToolbar count={rows.length} label="siswa">
            <select
              className="input sm:!w-auto sm:max-w-52"
              value={classId}
              onChange={e => setClassId(e.target.value)}
              aria-label="Filter kelas"
            >
              <option value="">Semua kelas</option>
              {classOptions.map((c, i) => (
                <option key={c.id ?? i} value={String(c.id ?? '')}>{String(c.name ?? '')}</option>
              ))}
            </select>
            <SearchBox
              className="w-full sm:w-64"
              label="Cari nama, NIS, atau username"
              placeholder="Cari nama / NIS…"
              value={search}
              onChange={v => { setSearch(v); setParams(p => { const n = new URLSearchParams(p); if (v) n.set('q', v); else n.delete('q'); return n }) }}
            />
          </TableToolbar>
        </div>

        {/* toolbar batch — muncul saat ada baris dipilih (directive §3A) */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-primary-line bg-primary-soft px-3 py-2">
            <span className="text-xs font-semibold text-primary">
              <span className="mono">{selected.size}</span> siswa dipilih
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setMoveTarget(''); setMoveOpen(true) }}>
                Pindah kelas
              </button>
              <button type="button" className="btn-quiet btn-sm" onClick={() => setDelBatchOpen(true)}>
                Hapus
              </button>
              <button type="button" className="btn-quiet btn-sm" onClick={() => setSelected(new Set())}>
                Batal
              </button>
            </div>
          </div>
        )}

        {list.isLoading ? (
          <div className="p-3">
            <SkeletonRows rows={4} cols={5} />
          </div>
        ) : list.isError ? (
          <div className="p-3">
            <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconStudents size={20} />} title="Belum ada siswa">
            Tambahkan manual atau import dari file Excel.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col" className="w-10">
                    <input
                      ref={headCheckRef}
                      type="checkbox"
                      aria-label="Pilih semua siswa di halaman ini"
                      checked={allSelected}
                      onChange={toggleAllRows}
                    />
                  </th>
                  <th scope="col" aria-sort={sort?.key === 'name' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <SortHeader label="Nama" active={sort?.key === 'name'} dir={sort?.dir ?? 'asc'} onClick={() => toggleSort('name')} />
                  </th>
                  <th scope="col" className="w-16">L/P</th>
                  <th scope="col" aria-sort={sort?.key === 'kelas' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <SortHeader label="Kelas" active={sort?.key === 'kelas'} dir={sort?.dir ?? 'asc'} onClick={() => toggleSort('kelas')} />
                  </th>
                  <th scope="col">NIS</th>
                  <th scope="col" className="num">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const id = String(r.id ?? '')
                  const name = String(r.full_name ?? r.name ?? '—')
                  return (
                    <tr key={r.id ?? i}>
                      <td data-th="Pilih" className="w-10">
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${name}`}
                          checked={selected.has(id)}
                          onChange={() => toggleRow(id)}
                        />
                      </td>
                      <td data-th="Nama">
                        <button
                          type="button"
                          className="text-left font-semibold text-primary hover:underline"
                          onClick={() => nav(`/students/${r.id}`)}
                        >
                          {name}
                        </button>
                        {r.username ? <div className="mono text-xs text-muted">@{String(r.username)}</div> : null}
                      </td>
                      <td data-th="L/P"><span className="mono">{String(r.gender ?? '—')}</span></td>
                      <td data-th="Kelas">{String(r.class_name ?? '—')}</td>
                      <td data-th="NIS"><span className="mono text-xs">{String(r.nis ?? '—')}</span></td>
                      <td data-th="Aksi" className="num">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => void openEdit(String(r.id ?? ''))}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-quiet btn-sm"
                            onClick={() => { setNewPass(null); setResetting({ id: String(r.id ?? ''), name: String(r.full_name ?? r.name ?? '') }) }}
                          >
                            Reset sandi
                          </button>
                          <button
                            type="button"
                            className="btn-quiet btn-sm text-danger"
                            onClick={() => setDeleting({ id: String(r.id ?? ''), name: String(r.full_name ?? r.name ?? '') })}
                          >
                            Hapus
                          </button>
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

      {/* modal tambah/edit siswa */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit Siswa' : 'Siswa Baru'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>Simpan</button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="label" htmlFor="st-name">Nama lengkap</label>
            <input
              id="st-name"
              className="input"
              required
              value={editing?.full_name ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, full_name: e.target.value } : f))}
              placeholder="Nama siswa"
            />
            <p className="hint mt-1">Nama tampil di kartu login dan laporan nilai.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st-g">Jenis kelamin</label>
              <select
                id="st-g"
                className="input"
                value={editing?.gender ?? 'L'}
                onChange={e => setEditing(f => (f ? { ...f, gender: e.target.value } : f))}
              >
                {GENDERS.map(g => <option key={g} value={g}>{g === 'L' ? 'Laki-laki (L)' : 'Perempuan (P)'}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="st-cls">Kelas</label>
              <select
                id="st-cls"
                className="input"
                value={editing?.class_id ?? ''}
                onChange={e => setEditing(f => (f ? { ...f, class_id: e.target.value } : f))}
              >
                <option value="">— pilih —</option>
                {classOptions.map((c, i) => <option key={c.id ?? i} value={String(c.id ?? '')}>{String(c.name ?? '')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="st-nis">
              NIS/NISN <span className="font-normal text-muted">(opsional)</span>
            </label>
            <input
              id="st-nis"
              className="input mono"
              value={editing?.nis ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, nis: e.target.value } : f))}
              placeholder="NIS"
            />
            <p className="hint mt-1">Dipakai saat import massal; boleh dikosongkan.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st-birth-place">Tempat lahir</label>
              <input
                id="st-birth-place"
                className="input"
                value={editing?.birth_place ?? ''}
                onChange={e => setEditing(f => (f ? { ...f, birth_place: e.target.value } : f))}
                placeholder="Purbalingga"
              />
            </div>
            <div>
              <label className="label" htmlFor="st-birth-date">Tanggal lahir</label>
              <input
                id="st-birth-date"
                type="date"
                className="input"
                value={editing?.birth_date ?? ''}
                onChange={e => setEditing(f => (f ? { ...f, birth_date: e.target.value } : f))}
              />
            </div>
          </div>
          <p className="hint -mt-1">Tempat & tanggal lahir tercetak di kartu ujian (gaya TKA).</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st-phone">HP siswa (WhatsApp)</label>
              <input
                id="st-phone"
                className="input mono"
                inputMode="tel"
                value={editing?.phone ?? ''}
                onChange={e => setEditing(f => (f ? { ...f, phone: e.target.value } : f))}
                placeholder="0812xxxxxxx"
              />
            </div>
            <div>
              <label className="label" htmlFor="st-parent-phone">HP orang tua</label>
              <input
                id="st-parent-phone"
                className="input mono"
                inputMode="tel"
                value={editing?.parent_phone ?? ''}
                onChange={e => setEditing(f => (f ? { ...f, parent_phone: e.target.value } : f))}
                placeholder="0812xxxxxxx"
              />
            </div>
          </div>
          <p className="hint -mt-1">Dipakai tombol kirim kartu ujian via WhatsApp (HP siswa didahulukan).</p>
        </form>
      </Modal>

      {/* wizard import (FR-3.3) */}
      <Modal
        open={importOpen}
        onClose={closeImport}
        title={{ upload: '1/3 Unduh & unggah template', preview: '2/3 Periksa pratinjau', done: '3/3 Kartu login siswa' }[step]}
        footer={step === 'preview'
          ? (
            <>
              <button type="button" className="btn-ghost" onClick={() => { setStep('upload'); setPreview(null) }} disabled={busy}>Kembali</button>
              <button type="button" className="btn-primary" onClick={commitImport} disabled={busy || !preview}>
                {busy ? 'Mengimport…' : `Import ${validCount} siswa`}
              </button>
            </>
          )
          : step === 'done' ? <button type="button" className="btn-primary" onClick={closeImport}>Selesai</button> : undefined}
      >
        <ImportSteps current={step} />

        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Unduh template (.xlsx), isi kolom <b className="text-text">Nama, Jenis Kelamin, Kelas</b> (+ NIS opsional), lalu unggah di sini.
            </p>
            <a
              className="btn-ghost btn-block"
              href={apiUrl('/students/export?format=xlsx')}
              onClick={e => { if (!getAccessToken()) { e.preventDefault(); toast('Harus masuk dulu untuk mengunduh', 'error') } }}
              target="_blank"
              rel="noopener"
            >
              <IconDownload size={16} /> Unduh template (.xlsx)
            </a>
            <div>
              <label className="label" htmlFor="imp-file">File daftar siswa</label>
              <input
                ref={fileRef}
                id="imp-file"
                type="file"
                accept=".xlsx,.csv"
                className="input !py-2"
                disabled={busy}
                onChange={e => void onUploadFile(e.target.files?.[0] ?? null)}
              />
              <p className="hint mt-1">Format .xlsx atau .csv, maksimal sesuai kuota paket.</p>
            </div>
            {busy && <div className="skeleton h-4 w-full" />}
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="badge border border-border bg-canvas text-muted">Total <span className="mono font-bold text-text">{preview.rows.length}</span></span>
              <span className="badge border border-success-line bg-success-soft text-success">Siap <span className="mono font-bold">{validCount}</span></span>
              <span className="badge border border-danger-line bg-danger-soft text-danger">Error <span className="mono font-bold">{problemCount}</span></span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <div className="table-scroll">
                <table className="table-base responsive-table">
                  <thead>
                    <tr>
                      <th scope="col">Nama</th>
                      <th scope="col" className="w-16">L/P</th>
                      <th scope="col">Kelas</th>
                      <th scope="col">Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => {
                      const problem = rowProblem(d(r))
                      return (
                        <tr key={i} className={problem ? 'bg-danger-soft' : ''}>
                          <td data-th="Nama" className={problem ? 'text-danger' : 'font-medium'}>{String(r.full_name ?? r.name ?? '—')}</td>
                          <td data-th="L/P"><span className="mono">{String(r.gender ?? '—')}</span></td>
                          <td data-th="Kelas">{String(r.class_name ?? r.class ?? '—')}</td>
                          <td data-th="Catatan" className={problem ? 'text-xs text-danger' : 'text-xs text-muted'}>
                            {problem || (
                              <span className="badge border border-success-line bg-success-soft text-success">Valid</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="hint">Kelas yang belum ada akan dibuat otomatis. Baris error merah tidak diimport.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3">
            <p className="text-sm">Username &amp; password awal dibuat otomatis — salin &amp; bagikan ke siswa:</p>
            <div className="space-y-1.5">
              {createdLogins.map((l, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-canvas px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="mono truncate text-[13px] font-semibold">@{l.username}</div>
                    <div className="text-xs text-muted">sandi awal: <span className="mono">{l.temp_pass}</span></div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost btn-sm shrink-0"
                    onClick={() => void copyLogin(`${l.username} / ${l.temp_pass}`, 'Kartu login disalin')}
                  >
                    Salin
                  </button>
                </div>
              ))}
            </div>
            {createdLogins.length > 1 && (
              <button
                type="button"
                className="btn-ghost btn-block"
                onClick={() => void copyLogin(createdLogins.map(l => `${l.username} / ${l.temp_pass}`).join('\n'), 'Semua kartu login disalin')}
              >
                <IconCopy size={14} /> Salin semua
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* modal reset password siswa */}
      <ConfirmDialog
        open={!!resetting && !newPass}
        message={`Buat password baru untuk ${resetting?.name ?? ''}? Login lama siswa akan ditimpa.`}
        onClose={() => setResetting(null)}
        onConfirm={resetPass}
        busy={busy}
      />

      <Modal
        open={!!newPass}
        onClose={() => setNewPass(null)}
        title="Password baru"
        footer={<button type="button" className="btn-primary" onClick={() => setNewPass(null)}>Tutup</button>}
      >
        <p className="text-sm">Password baru untuk {resetting?.name ?? 'siswa'}:</p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-canvas p-3">
          <span className="mono min-w-0 flex-1 break-all text-sm font-semibold">{newPass}</span>
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => void copyLogin(newPass ?? '')}>
            Salin
          </button>
        </div>
        <p className="hint">Bagikan lewat kanal aman dan minta siswa mengganti sandi setelah masuk.</p>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`Hapus siswa "${deleting?.name}"? Riwayat nilai ujiannya tetap tersimpan.`}
        danger
        busy={busy}
        onConfirm={del}
        onClose={() => setDeleting(null)}
      />

      {/* modal batch: pindah kelas */}
      <Modal
        open={moveOpen}
        onClose={() => { if (!moveBusy) setMoveOpen(false) }}
        title={`Pindahkan ${selected.size} siswa`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setMoveOpen(false)} disabled={moveBusy}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void doMoveClass()} disabled={moveBusy || !moveTarget}>
              {moveBusy ? 'Memindahkan…' : 'Pindahkan'}
            </button>
          </>
        }
      >
        <div>
          <label className="label" htmlFor="mv-class">Kelas tujuan</label>
          <select
            id="mv-class"
            className="input"
            value={moveTarget}
            disabled={moveBusy}
            onChange={e => setMoveTarget(e.target.value)}
          >
            <option value="">— pilih kelas —</option>
            {classOptions.map((c, i) => <option key={c.id ?? i} value={String(c.id ?? '')}>{String(c.name ?? '')}</option>)}
          </select>
        </div>
        {moveBusy && (
          <div className="space-y-1.5">
            <ProgressBar value={moveProg.done} max={moveProg.total || 1} label="Progres pindah kelas" />
            <p className="mono text-xs text-muted">
              {moveProg.done}/{moveProg.total}{moveProg.fail > 0 ? ` · ${moveProg.fail} gagal` : ''}
            </p>
          </div>
        )}
        <p className="hint">Diproses satu per satu; bila sebagian gagal, sisanya tetap dilanjutkan.</p>
      </Modal>

      {/* konfirmasi batch: hapus */}
      <ConfirmDialog
        open={delBatchOpen}
        title={`Hapus ${selected.size} siswa?`}
        message={busy && delProg.total > 0
          ? `Menghapus… ${delProg.done}/${delProg.total}${delProg.fail > 0 ? ` · ${delProg.fail} gagal` : ''}`
          : `Hapus ${selected.size} siswa yang dipilih pada halaman ini? Riwayat nilai mereka tetap tersimpan.`}
        danger
        busy={busy}
        confirmLabel="Ya, hapus terpilih"
        onConfirm={() => void doBatchDelete()}
        onClose={() => { if (!busy) setDelBatchOpen(false) }}
      />
    </div>
  )
}
