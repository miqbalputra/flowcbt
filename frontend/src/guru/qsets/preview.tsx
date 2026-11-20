// Pratinjau tampilan siswa untuk satu soal (FR-4.4) — dipakai dari editor paket soal
import { Modal } from '@/components/modal'
import {  LETTERS, qtypeLabel, renderSimpleHtml, type QType, asDict } from '../types'
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

  return (
    <Modal open={open} onClose={onClose} title="👀 Pratinjau tampilan siswa" footer={<button type="button" className="btn-primary" onClick={onClose}>Tutup</button>}>
      <div className="rounded-lg border border-border p-4 bg-bg space-y-3" style={{ maxWidth: 380, margin: '0 auto' }}>
        <div className="text-xs text-muted">{title} · soal {qtypeLabel(type)}</div>

        {stimulusHtml && (
          <div
            className="rounded-lg bg-surface border border-border p-3 text-sm prose-sm"
            dangerouslySetInnerHTML={{ __html: stimulusHtml }}
          />
        )}

        <div className="text-sm" dangerouslySetInnerHTML={{ __html: body }} />

        {(type === 'pg' || type === 'pg_kompleks') && (
          <div className="space-y-2">
            {options.map((o, i) => {
              const label = String(o.label ?? LETTERS[i] ?? '?')
              const isKey = correct.includes(label)
              return (
                <div key={i} className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm min-h-[44px] ${isKey ? 'border-success text-success' : 'border-border'}`}>
                  <span className="font-bold shrink-0">{label}.</span>
                  <span className="min-w-0" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(o.text ?? '')) }} />
                  {isKey && <span className="ml-auto shrink-0">✓</span>}
                </div>
              )
            })}
            {type === 'pg_kompleks' && <p className="text-xs text-muted">Pilih semua jawaban yang benar.</p>}
          </div>
        )}

        {type === 'menjodohkan' && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="space-y-2">
              {pairs.map((p, i) => (
                <div key={i} className="rounded-lg border border-primary/40 bg-primary-soft p-2.5 min-h-[44px]" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(p.left ?? '')) }} />
              ))}
            </div>
            <div className="space-y-2">
              {pairs.map((p, i) => (
                <div key={i} className="rounded-lg border border-border p-2.5 min-h-[44px]" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(p.right ?? '')) }} />
              ))}
            </div>
          </div>
        )}

        {type === 'isian' && (
          <input className="input" placeholder="Ketik jawabanmu di sini…" readOnly />
        )}

        {type === 'uraian' && (
          <textarea className="input min-h-24" placeholder="Tulis jawabanmu…" readOnly />
        )}

        {q.points !== undefined && <div className="text-xs text-muted text-right">Poin soal ini: <b>{String(q.points)}</b></div>}
      </div>
    </Modal>
  )
}
