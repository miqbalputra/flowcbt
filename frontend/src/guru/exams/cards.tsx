// Kartu Ujian — kartu peserta gaya TKA per ujian.
//
// Alur guru: pilih ujian (dari detail ujian) → lihat daftar peserta + nomor
// peserta → unduh PDF semua / per siswa, kirim WhatsApp otomatis (teks siap
// kirim + tautan PDF), dan lengkapi identitas sekolah untuk kepala kartu.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { downloadFile } from '../files'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import { Callout, EmptyState, ErrorBox, PageHeader, Panel, SkeletonRows, StatCard } from '../ui'
import { asDict, asList, errMessage, fmtDateTime, unwrap } from '../types'
import {
  IconDownload,
  IconEdit,
  IconExam,
  IconPhone,
  IconPrint,
  IconRefresh,
  IconStudents,
  IconCopy,
} from '@/components/icons'

type Card = {
  student_id: string
  number: string
  name: string
  nis: string
  class_name: string
  birth_place: string
  birth_date: string
  school: string
  phone: string
  whatsapp: string
}

/** wa.me butuh nomor tanpa +/spasi; 08xx → 628xx. */
function waNumber(raw: string): string {
  const d = String(raw || '').replace(/[^0-9]/g, '')
  if (!d) return ''
  if (d.startsWith('0')) return '62' + d.slice(1)
  if (d.startsWith('62')) return d
  return d
}

const tglID = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function ExamCards() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [busy, setBusy] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [form, setForm] = useState({ city: '', principal_name: '', principal_nip: '', region_code: '', school_code: '', address: '' })

  const q = useQuery({
    queryKey: ['exam-cards', id],
    queryFn: async () => unwrap(await api(`/exams/${id}/cards`)),
    enabled: Boolean(id),
  })

  const exam = asDict(q.data?.exam)
  const profile = asDict(q.data?.profile)
  const cards = useMemo(() => asList(q.data?.cards) as unknown as Card[], [q.data])
  const incomplete = !String(profile.principal_name ?? '').trim() || !String(profile.city ?? '').trim()

  function openProfile() {
    setForm({
      city: String(profile.city ?? ''),
      principal_name: String(profile.principal_name ?? ''),
      principal_nip: String(profile.principal_nip ?? ''),
      region_code: String(profile.region_code ?? ''),
      school_code: String(profile.school_code ?? ''),
      address: String(profile.address ?? ''),
    })
    setProfileOpen(true)
  }

  async function saveProfile() {
    setBusy('profile')
    try {
      await send('/school-profile', form, 'PUT')
      await qc.invalidateQueries({ queryKey: ['exam-cards', id] })
      setProfileOpen(false)
      toast('Identitas sekolah tersimpan', 'success')
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setBusy('')
    }
  }

  async function downloadAll() {
    setBusy('all')
    try {
      await downloadFile(`/exams/${id}/cards/pdf`, `kartu-${String(exam.exam_code ?? 'ujian')}.pdf`)
      toast('PDF semua peserta diunduh', 'success')
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setBusy('')
    }
  }

  async function downloadOne(c: Card) {
    setBusy('one-' + c.student_id)
    try {
      await downloadFile(`/exams/${id}/cards/${c.student_id}/pdf`, `kartu-${c.number || c.name}.pdf`)
      toast('PDF ' + c.name + ' diunduh', 'success')
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setBusy('')
    }
  }

  async function renumber() {
    setBusy('renumber')
    try {
      await send(`/exams/${id}/cards/renumber`, {}, 'POST')
      await qc.invalidateQueries({ queryKey: ['exam-cards', id] })
      toast('Nomor peserta disusun ulang', 'success')
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setBusy('')
    }
  }

  async function copyWA(c: Card) {
    try {
      await navigator.clipboard.writeText(c.whatsapp)
      toast('Teks WhatsApp disalin', 'success')
    } catch {
      toast('Browser menolak clipboard — salin manual dari pesan', 'error')
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Kartu Ujian"
        icon={<IconPrint size={17} />}
        title={String(exam.name ?? 'Kartu Ujian')}
        desc={`Nomor peserta, unduh PDF, dan kirim WhatsApp — format kartu peserta TKA.`}
        action={
          <>
            <Link to={`/exams/${id}`} className="btn btn-ghost btn-sm">
              Detail ujian
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={openProfile}>
              <IconEdit size={14} /> Identitas sekolah
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy === 'renumber' || cards.length === 0} onClick={() => void renumber()}>
              <IconRefresh size={14} /> Susun ulang nomor
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'all' || cards.length === 0} onClick={() => void downloadAll()}>
              <IconDownload size={14} /> Unduh PDF semua
            </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Peserta" value={cards.length} icon={<IconStudents size={15} />} />
        <StatCard label="Kode ujian" value={String(exam.exam_code ?? '—')} />
        <StatCard label="Token" value={String(exam.token ?? '—')} />
        {/* Tanggal panjang ("22 Nov 2026") terpotong pada kartu setengah lebar di
            ponsel: tampilkan tanggal ringkas + tahun di baris keterangan. */}
        <StatCard
          label="Jadwal"
          value={
            exam.open_at ? (
              <>
                {new Date(String(exam.open_at)).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                <span className="hidden sm:inline">{` ${new Date(String(exam.open_at)).getFullYear()}`}</span>
              </>
            ) : (
              '—'
            )
          }
          hint={
            exam.open_at ? (
              <>
                <span className="sm:hidden">{new Date(String(exam.open_at)).getFullYear()} · </span>
                {new Date(String(exam.open_at)).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
              </>
            ) : undefined
          }
        />
      </div>

      {incomplete && (
        <div className="mb-4">
          <Callout tone="warn" title="Identitas sekolah belum lengkap">
            Kepala kartu memakai nama sekolah; blok tanda tangan memakai <b>kota</b>, <b>nama kepala satuan pendidikan</b>, dan NIP.
            Lengkapi lewat tombol <b>Identitas sekolah</b> agar kartu siap cetak.
          </Callout>
        </div>
      )}

      <Panel
        title="Daftar peserta"
        flush
        action={
          <span className="mono text-xs text-muted">{String(exam.subject_name ?? '')}</span>
        }
      >
        {q.isLoading && <div className="p-4"><SkeletonRows rows={5} cols={5} /></div>}
        {q.isError && <div className="p-4"><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></div>}
        {!q.isLoading && !q.isError && cards.length === 0 && (
          <EmptyState icon={<IconStudents size={18} />} title="Belum ada peserta">
            Tugaskan kelas/siswa pada detail ujian, lalu kembali ke halaman ini.
          </EmptyState>
        )}
        {cards.length > 0 && (
          <>
            {/* tabel desktop */}
            <div className="table-scroll hidden md:block">
              <table className="table-base min-w-[920px]">
                <thead>
                  <tr>
                    <th className="w-[168px]">Nomor Peserta</th>
                    <th className="min-w-[180px]">Nama Peserta</th>
                    <th className="w-[80px]">Kelas</th>
                    <th className="min-w-[190px]">Tempat/Tgl Lahir</th>
                    <th className="w-[130px]">WhatsApp</th>
                    <th className="w-[132px] text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map(c => (
                    <tr key={c.student_id}>
                      <td className="mono whitespace-nowrap font-semibold">{c.number}</td>
                      <td className="font-medium">{c.name}</td>
                      <td className="whitespace-nowrap text-muted">{c.class_name || '—'}</td>
                      <td className="text-muted">
                        {c.birth_place || '—'}
                        {c.birth_date ? `, ${tglID(c.birth_date)}` : ''}
                      </td>
                      <td className="mono whitespace-nowrap text-muted">{c.phone || '—'}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            type="button" className="btn-ghost btn-sm !px-2" title="Unduh PDF kartu siswa ini"
                            aria-label={`Unduh PDF ${c.name}`}
                            disabled={busy === 'one-' + c.student_id} onClick={() => void downloadOne(c)}
                          >
                            <IconDownload size={14} />
                          </button>
                          <a
                            className={`btn-ghost btn-sm !px-2 ${c.phone ? '' : 'pointer-events-none opacity-40'}`}
                            href={c.phone ? `https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(c.whatsapp)}` : undefined}
                            target="_blank" rel="noreferrer" aria-label={`Kirim WhatsApp ${c.name}`}
                            title={c.phone ? 'Kirim kartu via WhatsApp' : 'Nomor WhatsApp belum ada'}
                          >
                            <IconPhone size={14} />
                          </a>
                          <button
                            type="button" className="btn-quiet btn-sm !px-2" title="Salin teks WhatsApp"
                            aria-label={`Salin teks WhatsApp ${c.name}`} onClick={() => void copyWA(c)}
                          >
                            <IconCopy size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* kartu mobile */}
            <ul className="divide-y divide-border md:hidden">
              {cards.map(c => (
                <li key={c.student_id} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{c.name}</div>
                      <div className="mono text-xs text-muted">{c.number}</div>
                    </div>
                    <span className="badge shrink-0">{c.class_name || '—'}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {c.birth_place || '—'}{c.birth_date ? `, ${tglID(c.birth_date)}` : ''} · {c.phone || 'HP belum ada'}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn-ghost btn-sm" disabled={busy === 'one-' + c.student_id} onClick={() => void downloadOne(c)}>
                      <IconDownload size={13} /> PDF
                    </button>
                    <a
                      className={`btn-ghost btn-sm ${c.phone ? '' : 'pointer-events-none opacity-50'}`}
                      href={c.phone ? `https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(c.whatsapp)}` : undefined}
                      target="_blank" rel="noreferrer"
                    >
                      <IconPhone size={13} /> WhatsApp
                    </a>
                    <button type="button" className="btn-quiet btn-sm" onClick={() => void copyWA(c)}>
                      <IconCopy size={13} /> Salin
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <p className="mt-3 text-xs text-muted">
        Kartu dicetak 3 peserta per halaman A4, tiap peserta 2 salinan (PANITIA & PESERTA) — sama seperti kartu TKA.
        Nomor peserta bersifat tetap agar cetak ulang tidak berubah.
      </p>

      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Identitas sekolah di kartu"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setProfileOpen(false)}>Batal</button>
            <button type="button" className="btn-primary" disabled={busy === 'profile'} onClick={() => void saveProfile()}>
              Simpan
            </button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Dipakai di kepala kartu dan blok tanda tangan. Nomor peserta memakai kode wilayah & kode sekolah di bawah.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="city">Kota (tanda tangan)</label>
            <input id="city" className="input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Purbalingga" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="principal">Nama kepala satuan pendidikan</label>
            <input id="principal" className="input" value={form.principal_name} onChange={e => setForm(f => ({ ...f, principal_name: e.target.value }))} placeholder="Muhamad Riana Yudianto, S.Kom." />
          </div>
          <div>
            <label className="label" htmlFor="nip">NIP</label>
            <input id="nip" className="input" value={form.principal_nip} onChange={e => setForm(f => ({ ...f, principal_nip: e.target.value }))} placeholder="-" />
          </div>
          <div>
            <label className="label" htmlFor="region">Kode wilayah</label>
            <input id="region" className="input mono" value={form.region_code} onChange={e => setForm(f => ({ ...f, region_code: e.target.value }))} placeholder="03-10" />
          </div>
          <div>
            <label className="label" htmlFor="school">Kode sekolah</label>
            <input id="school" className="input mono" value={form.school_code} onChange={e => setForm(f => ({ ...f, school_code: e.target.value }))} placeholder="0028" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="address">Alamat (opsional)</label>
            <input id="address" className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Jl. Pendidikan No. 12" />
          </div>
        </div>
        <p className="hint">
          Contoh nomor peserta: <span className="mono">TA-26-{form.region_code || '03-10'}-{form.school_code || '0028'}-0001-8</span>
        </p>
      </Modal>
    </>
  )
}
