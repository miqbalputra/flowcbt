// Pengaturan (§11): profil guru/admin, kelola guru + restrict kelas, tema.
// Profil: PUT /auth/me {name?, phone?, password?}; kelola guru: GET/POST /teachers, PUT/DELETE /teachers/{id}
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import { ThemeToggle } from '@/components/ThemeToggle'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows } from './ui'
import {  asDict, asList, copyText, errMessage, ROLE_LABELS, unwrap, unwrapList, qRows } from './types'

type Teacher = { id: string; name: string; email: string; role: string; class_ids: string[] }

export default function Settings() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: async () => unwrap(await api('/auth/me')) })
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => unwrapList(api('/teachers')) })
  const classes = useQuery({ queryKey: ['classes', 'settings'], queryFn: () => unwrapList(api('/classes')) })

  const m = me.data ? asDict(me.data.user ?? me.data) : {}
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [profileFilled, setProfileFilled] = useState(false)
  if (!profileFilled && (m.name || m.full_name)) {
    setProfileFilled(true)
    setName(String(m.full_name ?? m.name ?? ''))
    setPhone(String(m.phone ?? ''))
  }

  // kelola guru
  const [editT, setEditT] = useState<null | { id?: string; name: string; email: string; role: string; class_ids: string[] }>(null)
  const [inviting, setInviting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tempPass, setTempPass] = useState<{ email: string; temp_password: string } | null>(null)
  const [deleting, setDeleting] = useState<Teacher | null>(null)

  async function saveProfile() {
    setBusy(true)
    try {
      await send('/auth/me', ({
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          password: password || undefined,
        }), 'PUT')
      setPassword('')
      toast('Profil disimpan ✅', 'success')
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function toggleClass(cid: string) {
    setEditT(t => {
      if (!t) return t
      const has = t.class_ids.includes(cid)
      return { ...t, class_ids: has ? t.class_ids.filter(x => x !== cid) : [...t.class_ids, cid] }
    })
  }

  async function saveTeacher() {
    if (!editT) return
    if (!editT.id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editT.email)) { toast('Email guru tidak valid', 'error'); return }
    setBusy(true)
    try {
      if (editT.id) {
        await send(`/teachers/${editT.id}`, ({ name: editT.name.trim() || undefined, role: editT.role, class_ids: editT.class_ids }), 'PUT')
        toast('Data guru diperbarui ✅', 'success')
      } else {
        const res = unwrap(await send('/teachers', { email: editT.email.trim(), full_name: editT.name.trim() }, 'POST'))
        const d = asDict(res)
        setTempPass({
          email: String(d.email ?? editT.email),
          temp_password: String(d.temp_password ?? '—'),
        })
        toast('Undangan guru terkirim 📤', 'success')
      }
      setEditT(null)
      void qc.invalidateQueries({ queryKey: ['teachers'] })
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function delTeacher() {
    if (!deleting) return
    setBusy(true)
    try {
      await api(`/teachers/${deleting.id}`, { method: 'DELETE' })
      toast('Guru dihapus', 'success')
      setDeleting(null)
      void qc.invalidateQueries({ queryKey: ['teachers'] })
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Pengaturan" desc="Profil Anda, kelola guru, dan tampilan." />

      {/* profil (PUT /auth/me) */}
      <div className="card space-y-3">
        <h3 className="font-semibold">👤 Profil</h3>
        {me.isError ? (
          <ErrorBox error={me.error} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="st-name">Nama</label>
                <input id="st-name" className="input" value={name} onChange={e => setName(e.target.value)}
                  placeholder={String(m.full_name ?? m.name ?? '')} />
              </div>
              <div>
                <label className="label" htmlFor="st-phone">Nomor HP</label>
                <input id="st-phone" className="input" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder={String(m.phone ?? '—')} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="st-pass">Ganti password <span className="font-normal">(kosongkan bila tak diubah)</span></label>
              <input id="st-pass" className="input" type="password" autoComplete="new-password"
                value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void saveProfile()}>Simpan profil</button>
              <span className="text-xs text-muted ml-auto flex items-center gap-2">
                Tema <ThemeToggle />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* kelola guru (admin sekolah) */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">🧑‍🏫 Kelola guru</h3>
          <button type="button" className="btn-primary text-sm"
            onClick={() => setEditT({ name: '', email: '', role: 'teacher', class_ids: [] })}>＋ Undang Guru</button>
        </div>
        {teachers.isLoading ? (
          <SkeletonRows rows={2} cols={4} />
        ) : teachers.isError ? (
          <ErrorBox error={teachers.error} />
        ) : qRows(teachers).length === 0 ? (
          <EmptyState icon="🧑‍🏫" title="Belum ada guru lain" children="Undang via email di samping." />
        ) : (
          <table className="table-base responsive-table">
            <thead>
              <tr><th>Nama</th><th>Email</th><th>Peran</th><th>Akses kelas</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {qRows(teachers).map((t, i) => {
                const teacher = asDict(t)
                const ids = asList(teacher.class_ids ?? teacher.restricted_class_ids ?? []).map(String)
                return (
                  <tr key={teacher.id ?? i}>
                    <td data-th="Nama" className="font-medium">{String(teacher.name ?? '—')}</td>
                    <td data-th="Email" className="break-all">{String(teacher.email ?? '—')}</td>
                    <td data-th="Peran">{ROLE_LABELS[String(teacher.role ?? 'teacher')] ?? String(teacher.role ?? '—')}</td>
                    <td data-th="Akses kelas">{ids.length === 0 ? 'Semua' : `${ids.length} kelas`}</td>
                    <td data-th="Aksi">
                      <div className="flex gap-1.5 flex-wrap">
                        <button type="button" className="btn-ghost btn-sm"
                          onClick={() => setEditT({
                            id: String(teacher.id ?? ''),
                            name: String(teacher.name ?? ''),
                            email: String(teacher.email ?? ''),
                            role: ['owner', 'teacher'].includes(String(teacher.role)) ? String(teacher.role) : 'teacher',
                            class_ids: ids,
                          })}>Atur</button>
                        <button type="button" className="btn-danger btn-sm"
                          onClick={() => setDeleting({
                            id: String(teacher.id ?? ''),
                            name: String(teacher.name ?? ''),
                            email: String(teacher.email ?? ''),
                            role: String(teacher.role ?? 'teacher'),
                            class_ids: ids,
                          })}>Hapus</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* modal undang/atur guru */}
      <Modal
        open={!!editT && !tempPass}
        onClose={() => setEditT(null)}
        title={editT?.id ? 'Atur Guru' : 'Undang Guru'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditT(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void saveTeacher()} disabled={busy}>
              {busy ? 'Menyimpan…' : editT?.id ? 'Simpan' : 'Undang'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="t-name">Nama guru</label>
            <input id="t-name" className="input" value={editT?.name ?? ''}
              onChange={e => setEditT(t => (t ? { ...t, name: e.target.value } : t))} placeholder="Ibu Rina" />
          </div>
          <div>
            <label className="label" htmlFor="t-email">Email {editT?.id ? <span className="font-normal">(tidak bisa diubah)</span> : '(token undangan dikirim)'}</label>
            <input id="t-email" className="input" type="email" disabled={!!editT?.id} value={editT?.email ?? ''}
              onChange={e => setEditT(t => (t ? { ...t, email: e.target.value } : t))} placeholder="guru@sekolah.sch.id" />
          </div>
          <div>
            <label className="label" htmlFor="t-role">Peran</label>
            <select id="t-role" className="input" value={editT?.role ?? 'teacher'}
              onChange={e => setEditT(t => (t ? { ...t, role: e.target.value } : t))}>
              <option value="owner">Admin Sekolah</option>
              <option value="teacher">Guru</option>
            </select>
          </div>
          <div>
            <span className="label">Batasi akses kelas — kosongkan bila semua kelas</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {qRows(classes).map((c, i) => {
                const cid = String(c.id ?? '')
                return (
                  <label key={cid || i} className="flex items-center gap-2 rounded-lg border border-border p-2.5 min-h-[44px] cursor-pointer text-sm">
                    <input type="checkbox" checked={editT?.class_ids.includes(cid) ?? false} onChange={() => toggleClass(cid)} className="shrink-0" />
                    <span className="truncate">{String(c.name ?? '—')}</span>
                  </label>
                )
              })}
            </div>
            {classes.isError && <p className="text-xs text-danger mt-1">Gagal memuat daftar kelas — backend mungkin mati.</p>}
          </div>
        </div>
      </Modal>

      {/* kartu password sementara */}
      <Modal
        open={!!tempPass}
        onClose={() => setTempPass(null)}
        title="Sampai di sini dulu — password sementara"
        footer={<button type="button" className="btn-primary" onClick={() => setTempPass(null)}>Tutup</button>}
      >
        <p className="text-sm text-muted">Password awal guru (belum bisa direset ulang sebelum pertama login):</p>
        <div className="rounded-lg border border-border p-3 flex items-center gap-2">
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate">{tempPass?.email}</div>
            <div className="font-mono font-bold break-all">{tempPass?.temp_password}</div>
          </div>
          <button type="button" className="btn-ghost btn-sm shrink-0"
            onClick={() => void copyText(`${tempPass?.email} / ${tempPass?.temp_password}`, 'Login guru disalin 📋')}>
            Salin
          </button>
        </div>
        <p className="text-xs text-muted">Bagikan lewat kanal aman — guru diminta ganti password di login pertama.</p>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Hapus guru?"
        message={`Hapus akses ${deleting?.name ?? ''} (${deleting?.email ?? ''})? Soal & ujian miliknya tetap tersimpan.`}
        danger busy={busy}
        onConfirm={delTeacher}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
