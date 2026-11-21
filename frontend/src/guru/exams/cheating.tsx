// Laporan kecurangan per ujian (FR-5.8C): siswa flagged/warned + keputusan guru.
// PUT /attempts/{id}/cheating-decision {decision:"valid"|"cancel_penalty"|"disqualify", reason}
// Alasan wajib untuk batal/diskualifikasi — masuk audit log.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows } from '../ui'
import { asDict, asList, errMessage, fmtDateTime, unwrap } from '../types'
import { IconShield } from '@/components/icons'

const DECISIONS = [
  { value: 'valid', label: 'Valid — pertahankan penalti', reasonRequired: false },
  { value: 'cancel_penalty', label: 'Batalkan penalti', reasonRequired: true },
  { value: 'disqualify', label: 'Diskualifikasi (nilai 0)', reasonRequired: true },
]

export default function ExamCheating() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [deciding, setDeciding] = useState<Record<string, any> | null>(null)
  const [decision, setDecision] = useState('valid')
  const [reason, setReason] = useState('')

  const report = useQuery({
    queryKey: ['exams', id, 'cheating-report'],
    queryFn: async () => unwrap(await api(`/exams/${id}/cheating-report`)),
  })

  const rows = report.isLoading ? [] : report.isError ? [] : asList(report.data).filter(r => {
    const d = asDict(r)
    // hanya baris yang ditandai/perlu keputusan
    return d.attempt_id && (Number(d.total_violations ?? 0) > 0 || Boolean(d.cheating_status))
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

  function statusLabel(r: Record<string, any>): { label: string; cls: string } {
    const v = String(r.cheating_status ?? '')
    if (v === 'disqualified') return { label: 'Diskualifikasi', cls: 'text-danger' }
    if (v === 'flagged' || v === 'flag') return { label: 'Dilaporkan Curang', cls: 'text-danger' }
    if (v === 'warned' || v === 'warning') return { label: 'Diperingatkan', cls: 'text-warn' }
    if (Number(r.total_violations ?? 0) >= 3) return { label: 'Dilaporkan Curang', cls: 'text-danger' }
    if (Number(r.total_violations ?? 0) > 0) return { label: 'Diperingatkan', cls: 'text-warn' }
    return { label: 'Perlu Keputusan', cls: 'text-warn' }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Laporan Kecurangan"
        desc="Siswa yang ditandai keluar aplikasi & keputusan Anda sebagai guru."
        action={<Link className="btn-ghost text-sm" to={`/exams/${id}`}>Info ujian</Link>}
      />

      {report.isLoading ? (
        <SkeletonRows rows={3} cols={5} />
      ) : report.isError ? (
        <ErrorBox error={report.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconShield />} title="Tidak ada laporan kecurangan" children="Belum ada siswa yang ditandai pada ujian ini." />
      ) : (
        <div className="overflow-x-auto lg:overflow-visible">
        <table className="table-base responsive-table">
          <thead>
            <tr><th>Siswa</th><th>Kelas</th><th>Pelanggaran</th><th>Nilai (asli/akhir)</th><th>Status</th><th>Keputusan</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const st = statusLabel(r)
              const violations = asDict(r.violations ?? null)
              const detail = Object.entries(violations).filter(([, v]) => Number(v) > 0)
                .map(([k, v]) => `${k} ×${Number(v)}`).join(', ')
              return (
                <tr key={r.attempt_id ?? i}>
                  <td data-th="Siswa" className="font-medium">{String(r.name ?? '—')}</td>
                  <td data-th="Kelas">{String(r.class ?? '—')}</td>
                  <td data-th="Pelanggaran">
                    <b className={Number(r.total_violations ?? 0) >= 3 ? 'text-danger' : 'text-warn'}>
                      {String(r.total_violations ?? 0)}×
                    </b>
                    {detail && <div className="text-xs text-muted break-words">{detail}</div>}
                  </td>
                  <td data-th="Nilai">
                    {String(r.score ?? '—')} / <b>{String(r.final_score ?? '—')}</b>
                  </td>
                  <td data-th="Status">
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </td>
                  <td data-th="Keputusan">
                    <div className="flex gap-1.5 flex-wrap items-center">
                      {Array.isArray(r.decisions) && r.decisions.length > 0 ? (
                        <span className="text-xs text-muted">{String(asDict(r.decisions[r.decisions.length - 1]).decision ?? '—')}</span>
                      ) : (
                        <button type="button" className="btn-primary btn-sm"
                          onClick={() => { setDecision('valid'); setReason(''); setDeciding(r) }}>
                          Putuskan
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      <Modal
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={`Keputusan — ${String(deciding?.name ?? '')}`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setDeciding(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void submitDecision()} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan keputusan'}
            </button>
          </>
        }
      >
        <p className="text-sm text-muted mb-1">
          Pelanggaran dicatat di server; penalti dihitung dari event tersinkron (PRD FR-5.8A).
        </p>
        <div className="space-y-2">
          {DECISIONS.map(d => (
            <label key={d.value} className="flex items-center gap-2 rounded-lg border border-border p-2.5 min-h-[44px] cursor-pointer text-sm">
              <input type="radio" name="cheat-decision" checked={decision === d.value} onChange={() => setDecision(d.value)} />
              <span>{d.label}</span>
            </label>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="cr-reason">
            Alasan <span className="font-normal">{decision === 'valid' ? '(opsional)' : '(wajib — masuk audit log)'}</span>
          </label>
          <textarea id="cr-reason" className="input min-h-20" value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Contoh: gangguan jaringan bukan sengaja, terbukti dari riwayat koneksi." />
        </div>
      </Modal>
    </div>
  )
}
