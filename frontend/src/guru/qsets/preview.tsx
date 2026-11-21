// Pratinjau tampilan siswa untuk satu soal (FR-4.4) — dipakai dari editor paket soal.
// v3 "Portal Ujian": tiruan lembar ujian siswa — kepala lembar (judul + chip tipe/poin),
// stimulus, batang soal, opsi bergaya kartu jawaban, dan catatan kunci untuk guru.
import { Modal } from '@/components/modal'
import { LETTERS, qtypeLabel, renderSimpleHtml, type QType, asDict } from '../types'
import { IconCheck } from '@/components/icons'
import type { Dict } from '../types'

export function QuestionPreview({
  open, onClose, title, stimulusHtml, q,
}: {
  open: boolean
  onClose: () => void
  title: string
  stimulusHtml?: string
  q: Dict | null
}) {
  if (!q) return null
  const type = String(q.type ?? 'pg') as QType
  const body = renderSimpleHtml(String(q.body ?? ''))
  const options = Array.isArray(q.options) ? q.options.map((o: unknown) => asDict(o)) : []
  const correct = Array.isArray(q.correct) ? q.correct.map(String) : q.key ? [String(q.key)] : []
  const pairs = Array.isArray(q.pairs) ? q.pairs.map((p: unknown) => asDict(p)) : []
  const keys = Array.isArray(q.keys) ? q.keys.map(String) : []
  const multiple = type === 'pg_kompleks'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pratinjau tampilan siswa"
      footer={<button type="button" className="btn-primary" onClick={onClose}>Tutup</button>}
    >
      <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-md border border-border bg-surface">
        {/* kepala lembar ujian */}
        <div className="border-b border-border bg-canvas px-3 py-2.5">
          <div className="section-label">Lembar ujian siswa</div>
          <div className="mt-0.5 truncate text-[13px] font-semibold">{title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="chip">{qtypeLabel(type)}</span>
            {q.points !== undefined && <span className="chip mono">{String(q.points)} poin</span>}
            <span className="chip mono">Pratinjau</span>
          </div>
        </div>

        <div className="space-y-3 p-3">
          {stimulusHtml && (
            <div
              className="rounded-md border border-border bg-canvas p-2.5 text-[13px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: stimulusHtml }}
            />
          )}

          {/* batang soal */}
          <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: body }} />

          {(type === 'pg' || type === 'pg_kompleks') && (
            <div className="space-y-2" role="group" aria-label="Pilihan jawaban">
              {options.map((o, i) => {
                const label = String(o.label ?? LETTERS[i] ?? '?')
                const isKey = correct.includes(label)
                return (
                  <div
                    key={i}
                    className={`flex min-h-12 items-start gap-2.5 rounded-md border p-2.5 text-sm ${
                      isKey ? 'border-success-line bg-success-soft' : 'border-border-strong bg-surface'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mono flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                        isKey ? 'border-success-line bg-surface text-success' : 'border-border-strong bg-canvas text-text'
                      }`}
                    >
                      {label}
                    </span>
                    <span
                      className="min-w-0 flex-1 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(o.text ?? '')) }}
                    />
                    {isKey && <IconCheck size={14} className="mt-0.5 shrink-0 text-success" />}
                  </div>
                )
              })}
              {multiple && <p className="hint">Pilih semua jawaban yang benar.</p>}
            </div>
          )}

          {type === 'menjodohkan' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="section-label">Kolom kiri</div>
                {pairs.map((p, i) => (
                  <div
                    key={`l-${i}`}
                    className="flex min-h-11 items-center gap-2 rounded-md border border-primary-line bg-primary-soft p-2.5 text-sm"
                    dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(p.left ?? '')) }}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <div className="section-label">Kolom kanan</div>
                {pairs.map((p, i) => (
                  <div
                    key={`r-${i}`}
                    className="flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface p-2.5 text-sm"
                    dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(p.right ?? '')) }}
                  />
                ))}
              </div>
            </div>
          )}

          {type === 'isian' && (
            <div>
              <input className="input" placeholder="Ketik jawabanmu di sini…" readOnly aria-label="Contoh kolom jawaban isian" />
              <p className="hint mt-1">
                Jawaban dinilai otomatis{keys.length > 0 ? ` (${keys.length} kunci diterima)` : ''}, tidak peka huruf besar/kecil.
              </p>
            </div>
          )}

          {type === 'uraian' && (
            <div>
              <textarea className="input min-h-24" placeholder="Tulis jawabanmu…" readOnly aria-label="Contoh kolom jawaban uraian" />
              <p className="hint mt-1">Jawaban uraian dinilai guru berdasarkan rubrik.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-canvas px-3 py-2 text-[11px] text-muted">
          <span>Kunci jawaban ditandai hijau — hanya tampil di pratinjau guru.</span>
          {q.points !== undefined && (
            <span className="shrink-0">
              Poin <b className="mono text-text">{String(q.points)}</b>
            </span>
          )}
        </div>
      </div>
    </Modal>
  )
}
