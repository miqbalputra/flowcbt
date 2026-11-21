// Daftar siswa (FR-3.2..3.4): CRUD, filter kelas, pencarian, import wizard, export, kuota
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SearchBox, SkeletonRows, SortHeader, TableToolbar, sortRowsBy, type SortDir } from './ui'
import { IconCheck, IconCopy, IconDownload, IconPlus, IconStudents, IconUpload, IconWarn } from '@/components/icons'
import {  asDict, asList, asDict as d, errCode, errMessage, fmtDate, GENDERS, qs, unwrap, unwrapList, qRows, qNext } from './types'
import { apiUrl, uploadFile } from './files'
import { getAccessToken } from '@/lib/api'

const PAGE = 25
const EMPTY = { full_name: '', gender: 'L', class_id: '', nis: '' }

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

  const classes = useQuery({ queryKey: ['classes'], queryFn: () => unwrapList(api('/classes')) })
  const list = useQuery({
    queryKey: ['students', classId, debounced, cursor],
    queryFn: () => unwrapList(api(`/students${qs({ class_id: classId || undefined, q: debounced || undefined, limit: PAGE, cursor: cursor || undefined })}`)),
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
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.full_name.trim()) { toast('Nama siswa wajib diisi', 'error'); return }
    setBusy(true)
    const body: Record<string, unknown> = {
      full_name: editing.full_name.trim(),
      gender: editing.gender,
    }
    if (editing.class_id) body.class_id = editing.class_id
    if (editing.nis.trim()) body.nis = editing.nis.trim()
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Siswa"
        desc="Kelola data siswa, import massal, dan bagikan kartu login."
        icon={<IconStudents size={18} />}
        action={
          <div className="flex flex-wrap gap-2 justify-end">
            <a className="btn-ghost" href={apiUrl(`/students/export${qs({ class_id: classId || undefined, format: 'xlsx' })}`)}
              onClick={e => { if (!getAccessToken()) { e.preventDefault(); toast('Harus masuk dulu untuk export', 'error') } }}
              target="_blank" rel="noopener" title="Unduh .xlsx">
              <IconDownload size={16} /> XLSX
            </a>
            <button type="button" className="btn-ghost" onClick={() => setImportOpen(true)}><IconUpload size={16} /> Import</button>
            <button type="button" className="btn-primary" onClick={() => setEditing({ ...EMPTY })}><IconPlus size={16} /> Siswa</button>
          </div>
        }
      />

      {quotaExceeded && (
        <div className="card border-warn flex flex-wrap items-center gap-2 text-sm">
          <span className="text-warn shrink-0" aria-hidden><IconWarn size={18} /></span>
          <span><b>Kuota siswa habis</b> — naikkan paket untuk menambah siswa.</span>
          <button type="button" className="btn-primary ml-auto text-sm" onClick={() => nav('/billing')}>Upgrade paket →</button>
        </div>
      )}

      <TableToolbar count={rows.length} label="siswa">
        <select className="input sm:!w-auto sm:max-w-52" value={classId} onChange={e => setClassId(e.target.value)} aria-label="Filter kelas">
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

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={5} />
      ) : list.isError ? (
        <ErrorBox error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconStudents />} title="Belum ada siswa" children="Tambahkan manual atau import dari file Excel." />
      ) : (
        <>
          {/* toolbar batch — muncul saat ada baris dipilih (directive §3A) */}
          {selected.size > 0 && (
            <div className="card !py-2.5 border-l-4 border-l-primary flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium"><span className="font-mono">{selected.size}</span> dipilih</span>
              <div className="flex flex-wrap gap-2 ml-auto">
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setMoveTarget(''); setMoveOpen(true) }}>Pindah kelas ▾</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => setDelBatchOpen(true)}>Hapus</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Batal</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto lg:overflow-visible">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input ref={headCheckRef} type="checkbox" aria-label="Pilih semua siswa di halaman ini"
                      checked={allSelected} onChange={toggleAllRows} />
                  </th>
                  <th aria-sort={sort?.key === 'name' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <SortHeader label="Nama" active={sort?.key === 'name'} dir={sort?.dir ?? 'asc'} onClick={() => toggleSort('name')} />
                  </th>
                  <th>L/P</th>
                  <th aria-sort={sort?.key === 'kelas' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <SortHeader label="Kelas" active={sort?.key === 'kelas'} dir={sort?.dir ?? 'asc'} onClick={() => toggleSort('kelas')} />
                  </th>
                  <th>NIS</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(sort
                  ? sortRowsBy(rows, r => (sort.key === 'name' ? (r.full_name ?? r.name) : r.class_name), sort.dir)
                  : rows
                ).map((r, i) => {
                  const id = String(r.id ?? '')
                  return (
                    <tr key={r.id ?? i}>
                      <td data-th="Pilih" className="w-10">
                        <input type="checkbox" aria-label={`Pilih ${String(r.full_name ?? r.name ?? 'siswa')}`}
                          checked={selected.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                      <td data-th="Nama" className="font-medium">
                        <button type="button" className="text-primary hover:underline" onClick={() => nav(`/students/${r.id}`)}>
                          {String(r.full_name ?? r.name ?? '—')}
                        </button>
                        {r.username ? <div className="text-xs text-muted">@{String(r.username)}</div> : null}
                      </td>
                      <td data-th="L/P">{String(r.gender ?? '—')}</td>
                      <td data-th="Kelas">{String(r.class_name ?? '—')}</td>
                      <td data-th="NIS" className="font-mono text-xs">{String(r.nis ?? '—')}</td>
                      <td data-th="Aksi">
                        <div className="flex gap-1.5 flex-wrap">
                          <button type="button" className="btn-ghost btn-sm"
                            onClick={() => setEditing({
                              id: String(r.id ?? ''),
                              full_name: String(r.full_name ?? r.name ?? ''),
                              gender: String(r.gender ?? 'L').toUpperCase() === 'P' ? 'P' : 'L',
                              class_id: String(r.class_id ?? ''),
                              nis: String(r.nis ?? ''),
                            })}>Edit</button>
                          <button type="button" className="btn-ghost btn-sm"
                            onClick={() => { setNewPass(null); setResetting({ id: String(r.id ?? ''), name: String(r.full_name ?? r.name ?? '') }) }}>
                            Reset sandi
                          </button>
                          <button type="button" className="btn-danger btn-sm"
                            onClick={() => setDeleting({ id: String(r.id ?? ''), name: String(r.full_name ?? r.name ?? '') })}>Hapus</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {qNext(list) && (
            <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setCursor(qNext(list))}>
              Muat lebih banyak ↓
            </button>
          )}
        </>
      )}

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
            <input id="st-name" className="input" required value={editing?.full_name ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, full_name: e.target.value } : f))} placeholder="Nama siswa" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="st-g">Jenis kelamin</label>
              <select id="st-g" className="input" value={editing?.gender ?? 'L'}
                onChange={e => setEditing(f => (f ? { ...f, gender: e.target.value } : f))}>
                {GENDERS.map(g => <option key={g} value={g}>{g === 'L' ? 'Laki-laki (L)' : 'Perempuan (P)'}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="st-cls">Kelas</label>
              <select id="st-cls" className="input" value={editing?.class_id ?? ''}
                onChange={e => setEditing(f => (f ? { ...f, class_id: e.target.value } : f))}>
                <option value="">— pilih —</option>
                {classOptions.map((c, i) => <option key={c.id ?? i} value={String(c.id ?? '')}>{String(c.name ?? '')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="st-nis">NIS/NISN <span className="font-normal">(opsional)</span></label>
            <input id="st-nis" className="input" value={editing?.nis ?? ''}
              onChange={e => setEditing(f => (f ? { ...f, nis: e.target.value } : f))} placeholder="NIS" />
          </div>
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
                {busy ? 'Mengimport…' : `Import ${preview?.rows.filter(r => !rowProblem(d(r))).length ?? 0} siswa`}
              </button>
            </>
          )
          : step === 'done' ? <button type="button" className="btn-primary" onClick={closeImport}>Selesai</button> : undefined}
      >
        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Unduh template (.xlsx), isi kolom <b>Nama, Jenis Kelamin, Kelas</b> (+ NIS opsional), lalu unggah di sini.
            </p>
            <a className="btn-ghost w-full" href={apiUrl('/students/export?format=xlsx')} onClick={e => { if (!getAccessToken()) { e.preventDefault(); toast('Harus masuk dulu untuk mengunduh', 'error') } }} target="_blank" rel="noopener">
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
            </div>
            {busy && <div className="skeleton h-4 w-full" />}
          </div>
        )}
        {step === 'preview' && preview && (
          <div className="space-y-3">
            <div className="flex gap-3 text-sm flex-wrap">
              <span>Total: <b>{preview.rows.length}</b></span>
              <span className="text-success">Siap: <b>{preview.rows.filter(r => !rowProblem(d(r))).length}</b></span>
              <span className="text-danger">Error: <b>{preview.rows.filter(r => !!rowProblem(d(r))).length}</b></span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <div className="overflow-x-auto">
                <table className="table-base responsive-table">
                <thead>
                  <tr><th>Nama</th><th>L/P</th><th>Kelas</th><th>Catatan</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => {
                    const problem = rowProblem(d(r))
                    return (
                      <tr key={i} className={problem ? 'bg-danger-soft' : ''} style={problem ? { borderLeft: '3px solid var(--c-danger)' } : undefined}>
                        <td data-th="Nama" className={problem ? 'text-danger' : 'font-medium'}>{String(r.full_name ?? r.name ?? '—')}</td>
                        <td data-th="L/P">{String(r.gender ?? '—')}</td>
                        <td data-th="Kelas">{String(r.class_name ?? r.class ?? '—')}</td>
                        <td data-th="Catatan" className={problem ? 'text-danger text-xs' : 'text-xs text-muted'}>{problem || <IconCheck size={12} className="text-success" aria-label="Baris valid" />}</td>
                      </tr>
                    )
                  })}
                </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-muted">Kelas yang belum ada akan dibuat otomatis. Baris error merah tidak diimport.</p>
          </div>
        )}
        {step === 'done' && (
          <div className="space-y-3">
            <p className="text-sm">Username & password awal dibuat otomatis — salin & bagikan ke siswa:</p>
            {createdLogins.map((l, i) => (
              <div key={i} className="rounded-lg border border-border p-2.5 flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">@{l.username}</div>
                  <div className="text-xs text-muted">sandi awal: {l.temp_pass}</div>
                </div>
                <button type="button" className="btn-ghost btn-sm"
                  onClick={() => void copyLogin(`${l.username} / ${l.temp_pass}`, 'Kartu login disalin')}>
                  Salin
                </button>
              </div>
            ))}
            {createdLogins.length > 1 && (
              <button type="button" className="btn-ghost w-full text-sm"
                onClick={() => void copyLogin(createdLogins.map(l => `${l.username} / ${l.temp_pass}`).join('\n'), 'Semua kartu login disalin')}>
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
        <div className="rounded-lg border border-border p-3 font-mono text-sm flex items-center gap-2 break-all">
          <span className="min-w-0 flex-1">{newPass}</span>
          <button type="button" className="btn-ghost btn-sm shrink-0"
            onClick={() => void copyLogin(newPass ?? '')}>Salin</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        message={`Hapus siswa "${deleting?.name}"? Riwayat nilai ujiannya tetap tersimpan.`}
        danger busy={busy}
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
          <select id="mv-class" className="input" value={moveTarget} disabled={moveBusy}
            onChange={e => setMoveTarget(e.target.value)}>
            <option value="">— pilih kelas —</option>
            {classOptions.map((c, i) => <option key={c.id ?? i} value={String(c.id ?? '')}>{String(c.name ?? '')}</option>)}
          </select>
        </div>
        {moveBusy && (
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-border/40 overflow-hidden">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${moveProg.total ? Math.round((moveProg.done / moveProg.total) * 100) : 0}%` }} />
            </div>
            <p className="text-xs text-muted font-mono">
              {moveProg.done}/{moveProg.total}{moveProg.fail > 0 ? ` · ${moveProg.fail} gagal` : ''}
            </p>
          </div>
        )}
        <p className="text-xs text-muted">Diproses satu per satu; bila sebagian gagal, sisanya tetap dilanjutkan.</p>
      </Modal>

      {/* konfirmasi batch: hapus */}
      <ConfirmDialog
        open={delBatchOpen}
        title={`Hapus ${selected.size} siswa?`}
        message={busy && delProg.total > 0
          ? `Menghapus… ${delProg.done}/${delProg.total}${delProg.fail > 0 ? ` · ${delProg.fail} gagal` : ''}`
          : `Hapus ${selected.size} siswa yang dipilih pada halaman ini? Riwayat nilai mereka tetap tersimpan.`}
        danger busy={busy} confirmLabel="Ya, hapus terpilih"
        onConfirm={() => void doBatchDelete()}
        onClose={() => { if (!busy) setDelBatchOpen(false) }}
      />
    </div>
  )
}
