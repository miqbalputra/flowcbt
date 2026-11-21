// Laporan kecurangan per ujian (FR-5.8C): siswa flagged/warned + keputusan guru.
// PUT /attempts/{id}/cheating-decision {decision:"valid"|"cancel_penalty"|"disqualify", reason}
// Alasan wajib untuk batal/diskualifikasi — masuk audit log.
// Tampilan Design System v3: ringkasan angka, tabel keputusan, galeri snapshot proktor.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, getAccessToken } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import {
  Callout,
  EmptyState,
  ErrorBox,
  PageHeader,
  Panel,
  SearchBox,
  SkeletonRows,
  StatCard,
  TableToolbar,
} from '../ui'
import { asDict, asList, errMessage, fmtDateTime, unwrap } from '../types'
import { apiUrl } from '../files'
import { IconEdit, IconEye, IconInfo, IconShield, IconStudents, IconWarn } from '@/components/icons'

const DECISIONS = [
  { value: 'valid', label: 'Valid — pertahankan penalti', reasonRequired: false },
  { value: 'cancel_penalty', label: 'Batalkan penalti', reasonRequired: true },
  { value: 'disqualify', label: 'Diskualifikasi (nilai 0)', reasonRequired: true },
]

const DECISION_LABEL: Record<string, string> = {
  valid: 'Penalti dipertahankan',
  cancel_penalty: 'Penalti dibatalkan',
  disqualify: 'Diskualifikasi',
}

const VIO_LABEL: Record<string, string> = {
  tab_hidden: 'Keluar tab',
  blur: 'Jendela tidak fokus',
  fullscreen_exit: 'Keluar layar penuh',
  camera_off: 'Kamera mati',
  no_face: 'Wajah tidak terdeteksi',
  multi_face: 'Lebih dari satu wajah',
}
const vioLabel = (t: string) => VIO_LABEL[t] ?? t.replace(/_/g, ' ')

type VioSummary = { total: number; detail: string }

/** dukung dua bentuk respons: daftar item (backend) atau peta jumlah per tipe */
function violationSummary(r: Record<string, any>): VioSummary {
  const raw = r.violations
  if (Array.isArray(raw)) {
    const counts = new Map<string, number>()
    for (const item of raw) {
      const t = String(asDict(item).type ?? 'lainnya')
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return {
      total: Number(r.violations_count ?? raw.length),
      detail: [...counts.entries()].map(([t, n]) => `${vioLabel(t)} ×${n}`).join(', '),
    }
  }
  const entries = Object.entries(asDict(raw)).filter(([, n]) => Number(n) > 0)
  return {
    total: Number(r.total_violations ?? entries.reduce((s, [, n]) => s + Number(n), 0)),
    detail: entries.map(([k, n]) => `${vioLabel(k)} ×${Number(n)}`).join(', '),
  }
}

/** keputusan guru sudah ada? (decisions array atau catatan penalti server) */
function hasDecision(r: Record<string, any>): boolean {
  if (Array.isArray(r.decisions) && r.decisions.length > 0) return true
  return typeof r.penalty_note === 'string' && r.penalty_note.trim() !== ''
}

/** label keputusan dari catatan penalti server (format "keputusan <kode>: ...") */
function decisionText(r: Record<string, any>, last: string): string {
  if (last) return DECISION_LABEL[last] ?? last
  const note = String(r.penalty_note ?? '')
  if (/keputusan\s+valid/i.test(note)) return DECISION_LABEL.valid
  if (/keputusan\s+cancel_penalty/i.test(note)) return DECISION_LABEL.cancel_penalty
  if (/keputusan\s+disqualify/i.test(note)) return DECISION_LABEL.disqualify
  return 'Sudah diputuskan'
}

function cheatingBadge(r: Record<string, any>, total: number): { label: string; cls: string } {
  const v = String(r.cheating_status ?? '')
  if (v === 'disqualified') return { label: 'Diskualifikasi', cls: '!border-danger-line bg-danger-soft text-danger' }
  if (v === 'flagged' || v === 'flag') return { label: 'Dilaporkan Curang', cls: '!border-danger-line bg-danger-soft text-danger' }
  if (v === 'warned' || v === 'warning') return { label: 'Diperingatkan', cls: '!border-warn-line bg-warn-soft text-warn' }
  if (total >= 3) return { label: 'Dilaporkan Curang', cls: '!border-danger-line bg-danger-soft text-danger' }
  if (total > 0) return { label: 'Diperingatkan', cls: '!border-warn-line bg-warn-soft text-warn' }
  return { label: 'Perlu Keputusan', cls: '!border-warn-line bg-warn-soft text-warn' }
}

/** thumbnail snapshot butuh Authorization → ambil blob & pakai object URL */
function SnapshotThumb({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    let objectUrl = ''
    setUrl('')
    setFailed(false)
    const token = getAccessToken()
    if (!path || !token) {
      setFailed(true)
      return
    }
    const endpoint = path.startsWith('/api/v1') ? apiUrl(path.slice('/api/v1'.length)) : apiUrl(path)
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error(String(res.status))
        return res.blob()
      })
      .then(blob => {
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  if (failed) {
    return (
      <div
        className="flex h-24 items-center justify-center rounded border border-border bg-canvas text-muted"
        title="Snapshot tidak dapat dimuat"
        role="img"
        aria-label={`${alt} tidak tersedia`}
      >
        <IconWarn size={16} />
      </div>
    )
  }
  if (!url) return <div className="skeleton h-24 w-full" aria-hidden />

  return <img src={url} alt={alt} loading="lazy" className="h-24 w-full rounded border border-border object-cover" />
}

export default function ExamCheating() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [deciding, setDeciding] = useState<Record<string, any> | null>(null)
  const [decision, setDecision] = useState('valid')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')

  const report = useQuery({
    queryKey: ['exams', id, 'cheating-report'],
    queryFn: async () => unwrap(await api(`/exams/${id}/cheating-report`)),
  })

  const rows = report.isLoading ? [] : report.isError ? [] : asList(report.data).filter(r => {
    const d = asDict(r)
    // hanya baris yang ditandai/perlu keputusan
    const flagged = String(d.cheating_status ?? '')
    return d.attempt_id && (violationSummary(d).total > 0 || (flagged !== '' && flagged !== 'none' && flagged !== 'clean'))
  }).map(asDict)

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['exams', id, 'cheating-report'] })
    void qc.invalidateQueries({ queryKey: ['exams', id, 'attempts'] })
  }

  async function submitDecision() {
    if (!deciding) return
    const chosen = DECISIONS.find(d => d.value === decision)
    if (!chosen?.reasonRequired || !reason.trim()) {
      toast('Alasan wajib diisi untuk membatalkan penalti / mendiskualifikasi', 'error')
      return
    }
    setBusy(true)
    try {
      await send(`/attempts/${deciding.attempt_id}/cheating-decision`, { decision, reason: reason.trim() }, 'PUT')
      toast('Keputusan tersimpan — masuk audit log', 'success')
      setDeciding(null)
      setReason('')
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const summaries = rows.map(r => ({ r, vio: violationSummary(r) }))
  const totalViolations = summaries.reduce((s, x) => s + x.vio.total, 0)
  const pending = rows.filter(r => !hasDecision(r)).length
  const disqualified = rows.filter(r => String(r.cheating_status ?? '') === 'disqualified').length

  const keyword = search.trim().toLowerCase()
  const filtered = keyword
    ? summaries.filter(({ r }) =>
        [r.student_name, r.name, r.student_class, r.class]
          .some(v => String(v ?? '').toLowerCase().includes(keyword)))
    : summaries

  const shots = rows.flatMap(r =>
    asList(r.proctor).map((s, i) => ({
      key: `${String(r.attempt_id ?? '')}-${String(s.id ?? i)}`,
      url: String(s.url ?? ''),
      student: String(r.student_name ?? r.name ?? '—'),
      takenAt: s.taken_at,
    }))
  )

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Ujian · Pengawasan"
        title="Laporan Kecurangan"
        desc="Siswa yang ditandai keluar aplikasi & keputusan Anda sebagai guru."
        icon={<IconShield size={18} />}
        action={<Link to={`/exams/${id}`} className="btn-ghost btn-sm !min-h-11">Info ujian</Link>}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {report.isLoading ? (
          <div className="col-span-2 lg:col-span-4"><SkeletonRows rows={2} cols={4} /></div>
        ) : report.isError ? null : (
          <>
            <StatCard
              label="Siswa ditandai"
              value={String(rows.length)}
              hint="perlu ditinjau pengawas"
              tone={rows.length > 0 ? 'warn' : 'success'}
              icon={<IconStudents size={14} />}
            />
            <StatCard
              label="Total pelanggaran"
              value={String(totalViolations)}
              hint="event tersinkron"
              tone={totalViolations > 0 ? 'danger' : 'default'}
              icon={<IconWarn size={14} />}
            />
            <StatCard
              label="Perlu keputusan"
              value={String(pending)}
              hint="belum ada catatan guru"
              tone={pending > 0 ? 'warn' : 'default'}
              icon={<IconEdit size={14} />}
            />
            <StatCard
              label="Diskualifikasi"
              value={String(disqualified)}
              hint="nilai dinolkan permanen"
              tone={disqualified > 0 ? 'danger' : 'default'}
              icon={<IconShield size={14} />}
            />
          </>
        )}
      </div>

      <Callout tone="warn" title="Keputusan masuk audit log" icon={<IconInfo size={16} />}>
        Alasan wajib diisi untuk membatalkan penalti atau mendiskualifikasi. Pelanggaran tetap tersimpan sebagai histori.
      </Callout>

      {report.isLoading ? (
        <Panel><SkeletonRows rows={4} cols={5} /></Panel>
      ) : report.isError ? (
        <Panel><ErrorBox error={report.error} onRetry={() => void report.refetch()} /></Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState icon={<IconShield size={20} />} title="Tidak ada laporan kecurangan">
            Belum ada siswa yang ditandai pada ujian ini.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel
            title="Siswa Ditandai"
            icon={<IconShield size={15} />}
            action={<span className="chip mono">{rows.length}</span>}
            flush
          >
            <div className="border-b border-border p-3">
              <TableToolbar count={filtered.length} label="siswa">
                <SearchBox
                  className="w-full sm:w-64"
                  label="Cari siswa yang ditandai"
                  placeholder="Cari nama / kelas…"
                  value={search}
                  onChange={setSearch}
                />
              </TableToolbar>
            </div>

            {filtered.length === 0 ? (
              <EmptyState icon={<IconStudents size={18} />} title="Tidak ada siswa yang cocok">
                Ubah kata kunci pencarian nama atau kelas.
              </EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table-base responsive-table">
                  <thead>
                    <tr>
                      <th scope="col">Siswa</th>
                      <th scope="col">Kelas</th>
                      <th scope="col" className="num">Pelanggaran</th>
                      <th scope="col" className="num">Nilai (asli/akhir)</th>
                      <th scope="col">Status</th>
                      <th scope="col">Keputusan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ r, vio }, i) => {
                      const st = cheatingBadge(r, vio.total)
                      const lastDecision = Array.isArray(r.decisions) && r.decisions.length > 0
                        ? String(asDict(r.decisions[r.decisions.length - 1]).decision ?? '')
                        : ''
                      const decided = hasDecision(r)
                      const note = typeof r.penalty_note === 'string' ? r.penalty_note : ''
                      return (
                        <tr key={r.attempt_id ?? i}>
                          <td data-th="Siswa" className="font-medium">
                            <span className="block max-w-[16rem] truncate">
                              {String(r.student_name ?? r.name ?? '—')}
                            </span>
                          </td>
                          <td data-th="Kelas">{String(r.student_class ?? r.class ?? '—')}</td>
                          <td data-th="Pelanggaran" className="num">
                            <div className="space-y-0.5">
                              <div className={`mono font-bold ${vio.total >= 3 ? 'text-danger' : 'text-warn'}`}>
                                {vio.total}×
                              </div>
                              {vio.detail && (
                                <div className="min-w-0 max-w-[18rem] whitespace-normal break-words text-right text-xs text-muted">
                                  {vio.detail}
                                </div>
                              )}
                            </div>
                          </td>
                          <td data-th="Nilai" className="num mono">
                            {String(r.score ?? '—')} / <b>{String(r.final_score ?? '—')}</b>
                          </td>
                          <td data-th="Status">
                            <span className={`badge ${st.cls}`}>{st.label}</span>
                          </td>
                          <td data-th="Keputusan">
                            {decided ? (
                              <div className="min-w-0">
                                <span className="badge !border-border bg-canvas text-muted">
                                  {decisionText(r, lastDecision)}
                                </span>
                                {note && (
                                  <div className="mt-1 max-w-[18rem] whitespace-normal break-words text-xs text-muted">
                                    {note}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => { setDecision('valid'); setReason(''); setDeciding(r) }}
                              >
                                <IconEdit size={13} /> Putuskan
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Snapshot Proktor"
            icon={<IconEye size={15} />}
            action={<span className="chip mono">{shots.length}</span>}
            bodyClassName={shots.length === 0 ? '!p-0' : ''}
          >
            {shots.length === 0 ? (
              <EmptyState icon={<IconEye size={20} />} title="Belum ada snapshot">
                Snapshot kamera peserta akan muncul di sini setelah perangkat mengunggahnya.
              </EmptyState>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {shots.map(sh => (
                  <figure key={sh.key} className="min-w-0 overflow-hidden rounded-md border border-border bg-surface">
                    <SnapshotThumb path={sh.url} alt={`Snapshot ${sh.student}`} />
                    <figcaption className="space-y-0.5 border-t border-border px-2 py-1.5">
                      <div className="truncate text-[11px] font-semibold">{sh.student}</div>
                      <div className="mono truncate text-[10px] text-muted">{fmtDateTime(sh.takenAt)}</div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      <Modal
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={`Keputusan — ${String(deciding?.student_name ?? deciding?.name ?? '')}`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setDeciding(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void submitDecision()} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan keputusan'}
            </button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Pelanggaran dicatat di server; penalti dihitung dari event tersinkron (PRD FR-5.8A).
        </p>
        <div className="space-y-2">
          {DECISIONS.map(d => (
            <label
              key={d.value}
              className="choice !items-center"
              data-active={decision === d.value ? 'true' : 'false'}
            >
              <input
                type="radio"
                name="cheat-decision"
                checked={decision === d.value}
                onChange={() => setDecision(d.value)}
              />
              <span className="text-sm">{d.label}</span>
            </label>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="cr-reason">
            Alasan <span className="font-normal">{decision === 'valid' ? '(opsional)' : '(wajib — masuk audit log)'}</span>
          </label>
          <textarea
            id="cr-reason"
            className="input min-h-20"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Contoh: gangguan jaringan bukan sengaja, terbukti dari riwayat koneksi."
          />
          <p className="hint mt-1">Catatan ini tampil pada keputusan di tabel.</p>
        </div>
      </Modal>
    </div>
  )
}
