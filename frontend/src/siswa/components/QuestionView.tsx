// Komponen soal Area Siswa — 5 tipe AKM (mcq, mcq_complex, matching,
// short_answer, essay). Target sentuh ≥ 44 px (FR-6.3 / FR-11.2), mobile-first.
import { useState } from 'react'
import type { FetchedQuestion } from '../types'

/** Bentuk jawaban lintas tipe: string, string[], atau map pasangan matching. */
export type AnswerValue = string | string[] | Record<string, string> | null

export function QuestionView({
  q,
  value,
  onChange,
  disabled,
}: {
  q: FetchedQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  switch (q.type) {
    case 'mcq':
      return <McqList q={q} value={value} onChange={onChange} disabled={disabled} />
    case 'mcq_complex':
      return <McqComplexList q={q} value={value} onChange={onChange} disabled={disabled} />
    case 'matching':
      return <MatchingPairs q={q} value={value} onChange={onChange} disabled={disabled} />
    case 'short_answer':
      return <ShortAnswer q={q} value={value} onChange={onChange} disabled={disabled} />
    default: // essay & tipe tak dikenal
      return <EssayInput value={value} onChange={onChange} disabled={disabled} />
  }
}

/** Stimulus/wacana collapsible di atas soal (FR-6.3). */
export function StimulusCard({ text }: { text?: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <div className="card !p-0 mb-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 min-h-[44px] text-sm font-semibold"
      >
        <span>📄 Wacana</span>
        <span aria-hidden>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm whitespace-pre-wrap border-t border-border pt-3">{text}</div>
      )}
    </div>
  )
}

/* ---------------------------- pilihan ganda ---------------------------- */

function McqList({
  q,
  value,
  onChange,
  disabled,
}: {
  q: FetchedQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  const opts = q.options ?? []
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Pilihan jawaban">
      {opts.map((o, i) => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={`btn-ghost w-full !justify-start text-left ${active ? 'ring-2 ring-[var(--c-primary)] border-[var(--c-primary)]' : ''}`}
          >
            <span
              className={`badge shrink-0 ${active ? 'bg-primary text-primary-fg' : 'bg-bg border border-border text-muted'}`}
            >
              {String.fromCharCode(65 + i)}
            </span>
            <span className="min-w-0">{o.text}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------ pilihan ganda kompleks ------------------------ */

function McqComplexList({
  q,
  value,
  onChange,
  disabled,
}: {
  q: FetchedQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  const arr: string[] = Array.isArray(value) ? value : []
  const toggle = (id: string) => {
    if (disabled) return
    if (arr.includes(id)) onChange(arr.filter(x => x !== id))
    else onChange([...arr, id])
  }
  const opts = q.options ?? []
  return (
    <div className="space-y-2" role="group" aria-label="Pilih semua jawaban yang benar">
      <p className="text-xs text-muted">Pilih semua yang benar (boleh lebih dari satu).</p>
      {opts.map((o, i) => {
        const active = arr.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={disabled}
            onClick={() => toggle(o.id)}
            className={`btn-ghost w-full !justify-start text-left ${active ? 'ring-2 ring-[var(--c-primary)] border-[var(--c-primary)]' : ''}`}
          >
            <span className={`badge shrink-0 ${active ? 'bg-primary text-primary-fg' : 'bg-bg border border-border text-muted'}`}>
              {String.fromCharCode(65 + i)}
            </span>
            <span className="min-w-0">{o.text}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------- menjodohkan (matching) ------------------------ */

const PAIR_COLORS = ['#2563eb', '#be185d', '#047857', '#b45309', '#6d28d9', '#0e7490', '#7c2d12', '#4d7c0f']

function MatchingPairs({
  q,
  value,
  onChange,
  disabled,
}: {
  q: FetchedQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  const [selLeft, setSelLeft] = useState<string | null>(null)
  const pairs: Record<string, string> =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {}
  const left = q.left ?? []
  const right = q.right ?? []
  const usedRight = new Set(Object.values(pairs))

  const colorAt = (i: number) => PAIR_COLORS[i % PAIR_COLORS.length]

  const tapLeft = (id: string) => {
    if (disabled) return
    setSelLeft(cur => (cur === id ? null : id))
  }
  const tapRight = (rid: string) => {
    if (disabled || !selLeft) return
    const next: Record<string, string> = { ...pairs }
    for (const k of Object.keys(next)) {
      if (next[k] === rid) delete next[k] // sisi kanan tak boleh dua pasangan
    }
    next[selLeft] = rid
    onChange(next)
    setSelLeft(null)
  }
  const unpair = (leftId: string) => {
    if (disabled) return
    const next = { ...pairs }
    delete next[leftId]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Ketuk kotak di kiri, lalu ketuk pasangannya di kanan.</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          {left.map((l, i) => {
            const paired = pairs[l.id]
            const sel = selLeft === l.id
            return (
              <button
                key={l.id}
                type="button"
                disabled={disabled}
                onClick={() => tapLeft(l.id)}
                className={`btn-ghost w-full text-left !h-auto py-2 min-h-[44px] ${sel ? 'ring-2 ring-[var(--c-primary)]' : ''}`}
                aria-pressed={sel}
              >
                <span className="badge shrink-0 text-white" style={{ background: colorAt(i) }}>
                  {i + 1}
                </span>
                <span className="min-w-0">{l.text}</span>
                {paired && <span className="ml-auto text-xs text-muted">✓ dipasangkan</span>}
              </button>
            )
          })}
        </div>
        <div className="space-y-2">
          {right.map((r, i) => {
            const taken = usedRight.has(r.id)
            return (
              <button
                key={r.id}
                type="button"
                disabled={disabled}
                onClick={() => tapRight(r.id)}
                className={`btn-ghost w-full text-left !h-auto py-2 min-h-[44px] ${taken ? 'opacity-60' : ''}`}
              >
                <span className="badge shrink-0 text-white" style={{ background: colorAt(i) }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0">{r.text}</span>
              </button>
            )
          })}
        </div>
      </div>
      {Object.keys(pairs).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted">Pasangan terbentuk:</p>
          <ul className="text-sm space-y-1">
            {left
              .filter(l => pairs[l.id])
              .map((l, i) => {
                const ri = right.findIndex(r => r.id === pairs[l.id])
                return (
                  <li key={l.id} className="flex items-center gap-2 min-w-0">
                    <span className="badge shrink-0 text-white" style={{ background: colorAt(left.findIndex(x => x.id === l.id)) }}>
                      {left.indexOf(l) + 1} ↔ {String.fromCharCode(65 + ri)}
                    </span>
                    <span className="truncate">
                      {l.text} ↔ {right[ri]?.text}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost !min-h-9 !min-w-9 !p-0 ml-auto"
                      onClick={() => unpair(l.id)}
                      aria-label={`Lepas pasangan ${i + 1}`}
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ----------------------------- short answer ----------------------------- */

function ShortAnswer({
  q,
  value,
  onChange,
  disabled,
}: {
  q?: FetchedQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  const text = typeof value === 'string' ? value : ''
  // keyboard angka bila PERTANYAAN tampak matematika/angka (uji q.body, bukan string kosong)
  const numeric = /\b(hitung|jumlah|hasil|berapa)\b/i.test(String(q?.body ?? ''))
  return (
    <input
      className="input"
      value={text}
      disabled={disabled}
      placeholder="Ketik jawaban singkat…"
      inputMode={numeric ? 'numeric' : undefined}
      onChange={e => onChange(e.target.value)}
    />
  )
}

/* -------------------------------- essay --------------------------------- */

/** Batas ukuran essay di sisi klien (payload antrean tetap kecil, FR-7.3). */
const MAX_ESSAY_BYTES = 20 * 1024

/** Potong teks essay sampai ≤ 20 KB (aman untuk karakter multibyte/emoji). */
function clampEssay(text: string): string {
  if (new Blob([text]).size <= MAX_ESSAY_BYTES) return text // jalur cepat
  let s = text
  while (s.length > 1 && new Blob([s]).size > MAX_ESSAY_BYTES) {
    s = s.slice(0, Math.max(1, Math.floor(s.length * 0.9)))
  }
  return s
}

function EssayInput({
  value,
  onChange,
  disabled,
}: {
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  return (
    <textarea
      className="input min-h-[9rem] h-40"
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      placeholder="Tulis jawabanmu di sini…"
      onChange={e => onChange(clampEssay(e.target.value))}
    />
  )
}
