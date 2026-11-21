// Pengaturan (§11): profil guru/admin, keamanan akun, tema, kelola guru + restrict kelas.
// Profil: PUT /auth/me {name?, phone?, password?}; kelola guru: GET/POST /teachers, PUT/DELETE /teachers/{id}
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from './rpc'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import { ConfirmDialog } from '@/components/modal'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Callout, EmptyState, ErrorBox, PageHeader, Panel, SkeletonRows, TableToolbar } from './ui'
import { asDict, asList, copyText, errMessage, ROLE_LABELS, unwrap, unwrapList, qRows } from './types'
import { IconKey, IconPlus, IconSettings, IconShield, IconStudents, IconSun } from '@/components/icons'

type Teacher = { id: string; name: string; email: string; role: string; class_ids: string[] }

export default function Settings() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: async () => unwrap(await api('/auth/me')) })
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: async () => unwrapList(await api('/teachers')) })
  const classes = useQuery({ queryKey: ['classes', 'settings'], queryFn: async () => unwrapList(await api('/classes')) })

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
      toast('Profil disimpan', 'success')
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
        toast('Data guru diperbarui', 'success')
      } else {
        const res = unwrap(await send('/teachers', { email: editT.email.trim(), full_name: editT.name.trim() }, 'POST'))
        const d = asDict(res)
        setTempPass({
          email: String(d.email ?? editT.email),
          temp_password: String(d.temp_password ?? '—'),
        })
        toast('Undangan guru terkirim', 'success')
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

  const teacherRows = qRows(teachers)
  const classRows = qRows(classes)
  const myRole = String(m.role ?? '')

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Akun & Lembaga"
        title="Pengaturan"
        desc="Profil Anda, keamanan akun, tampilan, dan akses guru."
        icon={<IconSettings size={18} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* profil + keamanan (PUT /auth/me) */}
        <Panel
          title="Profil & keamanan"
          icon={<IconShield size={15} />}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="hint">Perubahan berlaku setelah disimpan.</span>
              <button type="button" className="btn-primary" disabled={busy || me.isLoading} onClick={() => void saveProfile()}>
                Simpan profil
              </button>
            </div>
          }
        >
          {me.isLoading ? (
            <SkeletonRows rows={2} cols={2} />
          ) : me.isError ? (
            <ErrorBox error={me.error} onRetry={() => void me.refetch()} />
          ) : (
            <div className="space-y-4">
              <div>
                <div className="section-label mb-2">Identitas</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="st-name">Nama</label>
                    <input
                      id="st-name"
                      className="input"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={String(m.full_name ?? m.name ?? '')}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="st-phone">Nomor HP</label>
                    <input
                      id="st-phone"
                      className="input mono"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder={String(m.phone ?? '—')}
                    />
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  <span>
                    Email <b className="ml-1 font-semibold text-text">{String(m.email ?? '—')}</b>
                  </span>
                  <span>
                    Peran <b className="ml-1 font-semibold text-text">{ROLE_LABELS[myRole] ?? (myRole || '—')}</b>
                  </span>
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <div className="section-label mb-2 flex items-center gap-1.5">
                  <IconKey size={12} aria-hidden /> Keamanan akun
                </div>
                <label className="label" htmlFor="st-pass">
                  Ganti password <span className="font-normal text-muted">(kosongkan bila tak diubah)</span>
                </label>
                <input
                  id="st-pass"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <p className="hint mt-1">Isi hanya bila ingin mengganti sandi akun; kosongkan untuk mempertahankan sandi lama.</p>
              </div>
            </div>
          )}
        </Panel>

        {/* tampilan */}
        <Panel title="Tampilan" icon={<IconSun size={15} />}>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-canvas px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Tema aplikasi</div>
              <p className="mt-0.5 text-xs text-muted">Terang atau gelap, tersimpan di perangkat ini.</p>
            </div>
            <ThemeToggle />
          </div>
          <p className="hint mt-2">Bawaan mengikuti preferensi tampilan perangkat Anda.</p>
        </Panel>
      </div>

      {/* kelola guru (admin sekolah) */}
      <Panel
        title="Kelola guru"
        icon={<IconStudents size={15} />}
        flush
        action={
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => setEditT({ name: '', email: '', role: 'teacher', class_ids: [] })}
          >
            <IconPlus size={14} /> Undang guru
          </button>
        }
        footer={<span className="hint">Batasi akses kelas bila guru hanya boleh mengelola kelas tertentu.</span>}
      >
        <div className="border-b border-border p-3">
          <TableToolbar count={teacherRows.length} label="guru">
            <span className="text-xs text-muted">Tanpa batasan = akses semua kelas</span>
          </TableToolbar>
        </div>

        {teachers.isLoading ? (
          <div className="p-3">
            <SkeletonRows rows={2} cols={4} />
          </div>
        ) : teachers.isError ? (
          <div className="p-3">
            <ErrorBox error={teachers.error} onRetry={() => void teachers.refetch()} />
          </div>
        ) : teacherRows.length === 0 ? (
          <EmptyState icon={<IconStudents size={20} />} title="Belum ada guru lain">
            Undang rekan guru lewat tombol "Undang guru" di kanan atas.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Nama</th>
                  <th scope="col">Email</th>
                  <th scope="col">Peran</th>
                  <th scope="col">Akses kelas</th>
                  <th scope="col" className="num">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {teacherRows.map((t, i) => {
                  const teacher = asDict(t)
                  const ids = asList(teacher.class_ids ?? teacher.restricted_class_ids ?? []).map(String)
                  const roleLabel = ROLE_LABELS[String(teacher.role ?? 'teacher')] ?? String(teacher.role ?? '—')
                  return (
                    <tr key={teacher.id ?? i}>
                      <td data-th="Nama" className="font-semibold">{String(teacher.name ?? '—')}</td>
                      <td data-th="Email" className="break-all text-muted">{String(teacher.email ?? '—')}</td>
                      <td data-th="Peran"><span className="chip">{roleLabel}</span></td>
                      <td data-th="Akses kelas">
                        {ids.length === 0 ? 'Semua' : <><span className="mono">{ids.length}</span> kelas</>}
                      </td>
                      <td data-th="Aksi" className="num">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => setEditT({
                              id: String(teacher.id ?? ''),
                              name: String(teacher.name ?? ''),
                              email: String(teacher.email ?? ''),
                              role: ['owner', 'teacher'].includes(String(teacher.role)) ? String(teacher.role) : 'teacher',
                              class_ids: ids,
                            })}
                          >
                            Atur
                          </button>
                          <button
                            type="button"
                            className="btn-quiet btn-sm"
                            onClick={() => setDeleting({
                              id: String(teacher.id ?? ''),
                              name: String(teacher.name ?? ''),
                              email: String(teacher.email ?? ''),
                              role: String(teacher.role ?? 'teacher'),
                              class_ids: ids,
                            })}
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
        <div className="space-y-4">
          <div>
            <div className="section-label mb-2">Identitas guru</div>
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="t-name">Nama guru</label>
                <input
                  id="t-name"
                  className="input"
                  value={editT?.name ?? ''}
                  onChange={e => setEditT(t => (t ? { ...t, name: e.target.value } : t))}
                  placeholder="Ibu Rina"
                />
              </div>
              <div>
                <label className="label" htmlFor="t-email">
                  Email {editT?.id ? <span className="font-normal text-muted">(tidak bisa diubah)</span> : '(token undangan dikirim)'}
                </label>
                <input
                  id="t-email"
                  className="input"
                  type="email"
                  disabled={!!editT?.id}
                  value={editT?.email ?? ''}
                  onChange={e => setEditT(t => (t ? { ...t, email: e.target.value } : t))}
                  placeholder="guru@sekolah.sch.id"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="section-label mb-2">Peran & akses</div>
            <div>
              <label className="label" htmlFor="t-role">Peran</label>
              <select
                id="t-role"
                className="input"
                value={editT?.role ?? 'teacher'}
                onChange={e => setEditT(t => (t ? { ...t, role: e.target.value } : t))}
              >
                <option value="owner">Admin Sekolah</option>
                <option value="teacher">Guru</option>
              </select>
            </div>
            <div className="mt-3">
              <div className="label">Batasi akses kelas — kosongkan bila semua kelas</div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-canvas p-1.5">
                {classRows.length === 0 ? (
                  <p className="px-1.5 py-2 text-xs text-muted">Belum ada kelas untuk dipilih.</p>
                ) : (
                  classRows.map((c, i) => {
                    const cid = String(c.id ?? '')
                    return (
                      <label
                        key={cid || i}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-surface"
                      >
                        <input
                          type="checkbox"
                          checked={editT?.class_ids.includes(cid) ?? false}
                          onChange={() => toggleClass(cid)}
                          className="shrink-0"
                        />
                        <span className="truncate">{String(c.name ?? '—')}</span>
                      </label>
                    )
                  })
                )}
              </div>
              {classes.isError && (
                <div className="mt-2">
                  <Callout tone="danger">Gagal memuat daftar kelas — backend mungkin mati.</Callout>
                </div>
              )}
            </div>
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
        <div className="flex items-center gap-2 rounded-md border border-border bg-canvas p-3">
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate">{tempPass?.email}</div>
            <div className="mono break-all font-bold">{tempPass?.temp_password}</div>
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0"
            onClick={() => void copyText(`${tempPass?.email} / ${tempPass?.temp_password}`, 'Login guru disalin')}
          >
            Salin
          </button>
        </div>
        <p className="hint">Bagikan lewat kanal aman — guru diminta ganti password di login pertama.</p>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Hapus guru?"
        message={`Hapus akses ${deleting?.name ?? ''} (${deleting?.email ?? ''})? Soal & ujian miliknya tetap tersimpan.`}
        danger
        busy={busy}
        onConfirm={delTeacher}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
