// Daftar siswa (FR-3.2..3.4): CRUD, filter kelas, pencarian, import wizard, export, kuota
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows } from './ui'
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
      toast(`${dd.created_count ?? preview.rows.length} siswa diimport 🎉`, 'success')
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
        toast('Data siswa diperbarui ✅', 'success')
      } else {
        await send('/students', body, 'POST')
        toast('Siswa ditambahkan 🎉', 'success')
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

  async function copyLogin(text: string, msg = 'Kartu login disalin 📋') {
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
        action={
          <div className="flex gap-2">
            <a className="btn-ghost" href={apiUrl(`/students/export${qs({ class_id: classId || undefined, format: 'xlsx' })}`)}
              onClick={e => { if (!getAccessToken()) { e.preventDefault(); toast('Harus masuk dulu untuk export', 'error') } }}
              target="_blank" rel="noopener" title="Unduh .xlsx">
              ⬇️ XLSX
            </a>
            <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>📥 Import</button>
            <button type="button" className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>＋ Siswa</button>
          </div>
        }
      />

      {quotaExceeded && (
        <div className="card border-warn flex flex-wrap items-center gap-2 text-sm">
          <span>⚠️ <b>Kuota siswa habis</b> — naikkan paket untuk menambah siswa.</span>
          <button type="button" className="btn-primary ml-auto text-sm" onClick={() => nav('/billing')}>Upgrade paket →</button>
        </div>
      )}

      <div className="card flex flex-col sm:flex-row gap-2 sm:items-center">
        <select className="input sm:max-w-52" value={classId} onChange={e => setClassId(e.target.value)} aria-label="Filter kelas">
          <option value="">Semua kelas</option>
          {classOptions.map((c, i) => (
            <option key={c.id ?? i} value={String(c.id ?? '')}>{String(c.name ?? '')}</option>
          ))}
        </select>
        <input className="input" type="search" aria-label="Cari nama, NIS, atau username" placeholder="🔍 Cari nama / NIS…" value={search}
          onChange={e => { setSearch(e.target.value); setParams(p => { const n = new URLSearchParams(p); if (e.target.value) n.set('q', e.target.value); else n.delete('q'); return n }) }} />
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={5} />
      ) : list.isError ? (
        <ErrorBox error={list.error} />
      ) : qRows(list).length === 0 ? (
        <EmptyState icon="🧑‍🎓" title="Belum ada siswa" children="Tambahkan manual atau import dari file Excel." />
      ) : (
        <>
          <table className="table-base responsive-table">
            <thead>
              <tr><th>Nama</th><th>L/P</th><th>Kelas</th><th>NIS</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {qRows(list).map((r, i) => (
                <tr key={r.id ?? i}>
                  <td data-th="Nama" className="font-medium">
                    <button type="button" className="text-primary hover:underline" onClick={() => nav(`/students/${r.id}`)}>
                      {String(r.full_name ?? r.name ?? '—')}
                    </button>
                    {r.username ? <div className="text-xs text-muted">@{String(r.username)}</div> : null}
                  </td>
                  <td data-th="L/P">{String(r.gender ?? '—')}</td>
                  <td data-th="Kelas">{String(r.class_name ?? '—')}</td>
                  <td data-th="NIS">{String(r.nis ?? '—')}</td>
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
              ))}
            </tbody>
          </table>
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
              ⬇️ Unduh template (.xlsx)
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
              <table className="table-base responsive-table">
                <thead>
                  <tr><th>Nama</th><th>L/P</th><th>Kelas</th><th>Catatan</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => {
                    const problem = rowProblem(d(r))
                    return (
                      <tr key={i} className={problem ? 'bg-danger/5' : ''} style={problem ? { borderLeft: '3px solid var(--c-danger)' } : undefined}>
                        <td data-th="Nama" className={problem ? 'text-danger' : 'font-medium'}>{String(r.full_name ?? r.name ?? '—')}</td>
                        <td data-th="L/P">{String(r.gender ?? '—')}</td>
                        <td data-th="Kelas">{String(r.class_name ?? r.class ?? '—')}</td>
                        <td data-th="Catatan" className={problem ? 'text-danger text-xs' : 'text-xs text-muted'}>{problem || '✓'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
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
                  onClick={() => void copyLogin(`${l.username} / ${l.temp_pass}`, 'Kartu login disalin 📋')}>
                  Salin
                </button>
              </div>
            ))}
            {createdLogins.length > 1 && (
              <button type="button" className="btn-ghost w-full text-sm"
                onClick={() => void copyLogin(createdLogins.map(l => `${l.username} / ${l.temp_pass}`).join('\n'), 'Semua kartu login disalin 📋')}>
                📋 Salin semua
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
    </div>
  )
}
