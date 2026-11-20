// Komponen soal Area Siswa — kartu opsi gaya lembar ujian nasional (directive §2A).
// - Kartu full-width, klik di mana saja pada kartu memilih; target sentuh ≥ 48px.
// - Kotak huruf A–E font-mono 32px; terpilih = border-2 primary + tint primary-soft.
// - Matching tetap tap-pilih kiri→kanan dengan warna pasangan (PAIR_COLORS).
// Kontrak LAMA dipertahankan: prop (q, value, onChange, disabled) + AnswerValue.
import { useState } from 'react'
import type { FetchedQuestion } from '../types'
import { renderSimpleHtml } from '@/lib/sanitize'

/** Bentuk jawaban lintas tipe: string, string[], atau map pasangan matching. */
export type AnswerValue = string | string[] | Record<string, string> | null

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/* --------------------------- primitif visual --------------------------- */

/** Kotak huruf 32px font-mono — indikator pilihan (terpilih = peril strip biru). */
function LetterBox({ letter, active, check = false }: { letter: string; active: boolean; check?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border font-mono text-sm font-bold transition-colors
        ${active ? 'border-primary bg-primary-bg text-primary-fg' : 'border-border bg-canvas text-text'}`}
    >
      {active && check ? '✓' : letter}
    </span>
  )
}

/** Kelas kartu opsi (MCQ & kompleks): border-2 jelas, radius lg, 48px, tekan 0.99. */
function cardCls(active: boolean, disabled?: boolean): string {
  return [
    'flex w-full items-start gap-3 rounded-lg border-2 p-3 text-left min-h-12',
    'transition-[background-color,border-color] active:scale-[0.99]',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
    active
      ? 'border-primary bg-primary-soft/50'
      : 'border-border-strong bg-surface hover:bg-canvas',
  ].join(' ')
}

/* ------------------------------- routing ------------------------------- */

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
            className={cardCls(active, disabled)}
          >
            <LetterBox letter={LETTERS[i] ?? '·'} active={active} />
            <span className="min-w-0 flex-1 break-words leading-relaxed">{o.text || `Pilihan ${LETTERS[i]}`}</span>
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
  const opts = q.options ?? []
  return (
    <div className="space-y-2" role="group" aria-label="Pilih semua jawaban yang benar">
      <p className="text-xs text-muted">Pilih semua jawaban yang benar — boleh lebih dari satu.</p>
      {opts.map((o, i) => {
        const active = arr.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={disabled}
            onClick={() => toggleComplex(arr, o.id, onChange)}
            className={cardCls(active, disabled)}
          >
            <LetterBox letter={LETTERS[i] ?? '·'} active={active} check />
            <span className="min-w-0 flex-1 break-words leading-relaxed">{o.text || `Pilihan ${LETTERS[i]}`}</span>
          </button>
        )
      })}
    </div>
  )
}

function toggleComplex(arr: string[], id: string, onChange: (v: AnswerValue) => void) {
  // keyboard 'a'-'e' & klik memanggil reducer yang sama: tambah/hapus (FR-6.3)
  onChange(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id])
}

/* ------------------------- menjodohkan (matching) ------------------------ */

const PAIR_COLORS = ['#2563eb', '#be185d', '#047857', '#b45309', '#6d28d9', '#0e7490', '#7c2d12', '#4d7c0f']
const colorAt = (i: number) => PAIR_COLORS[i % PAIR_COLORS.length]

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

  const tapLeft = (id: string) => {
    if (disabled) return
    setSelLeft(cur => (cur === id ? null : id)) // tap dulu kiri …
  }
  const tapRight = (rid: string) => {
    if (disabled || !selLeft) return // … lalu kanan (highlight aktif)
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
  const leftIndexById = (id: string) => left.findIndex(l => l.id === id)
  const rightDone = (rid: string) => left.some(l => pairs[l.id] === rid)

  // Kartu kolom kiri (pernyataan) — tap untuk memilih
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Ketuk kotak di <b>kolom kiri</b>, lalu ketuk pasangannya di <b>kolom kanan</b>.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-2">
          {left.map((l, i) => {
            const pairedTo = pairs[l.id]
            const sel = selLeft === l.id
            const done = Boolean(pairedTo)
            return (
              <button
                key={l.id}
                type="button"
                disabled={disabled}
                onClick={() => tapLeft(l.id)}
                aria-pressed={sel}
                className={`flex w-full items-start gap-2.5 rounded-lg border-2 p-2.5 text-left min-h-12
                  transition-[background-color,border-color] active:scale-[0.99]
                  disabled:cursor-not-allowed disabled:opacity-50
                  ${sel
                    ? 'border-primary bg-primary-soft/50'
                    : done
                      ? 'bg-surface hover:bg-canvas'
                      : 'border-border-strong bg-surface hover:bg-canvas'}`}
                style={done ? { borderColor: colorAt(i) } : undefined}
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent font-mono text-sm font-bold text-white"
                  style={{ background: colorAt(i) }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 break-words leading-snug">
                  {l.text}
                  {pairedTo && (
                    <span
                      className="ml-1 inline-block rounded-sm px-1 font-mono text-[11px] font-bold text-white align-middle"
                      style={{ background: colorAt(i) }}
                    >
                      {String.fromCharCode(65 + right.findIndex(r => r.id === pairedTo))}
                    </span>
                  )}
                </span>
                {sel && <span className="shrink-0 font-mono text-xs font-bold text-primary" aria-hidden>→…</span>}
              </button>
            )
          })}
        </div>
        <div className="space-y-2">
          {right.map((r, i) => {
            const taken = rightDone(r.id)
            const ri = right.findIndex(x => x.id === r.id)
            return (
              <button
                key={r.id}
                type="button"
                disabled={disabled || !selLeft}
                onClick={() => tapRight(r.id)}
                aria-label={`Jodohkan dengan ${LETTERS[i] ?? i + 1}`}
                className={`flex w-full items-start gap-2.5 rounded-lg border-2 p-2.5 text-left min-h-12
                  transition-[background-color,border-color] active:scale-[0.99]
                  disabled:cursor-not-allowed disabled:opacity-50
                  ${!selLeft && !taken
                    ? 'border-border-strong bg-canvas text-muted'
                    : 'border-border-strong bg-surface hover:bg-canvas'}`}
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent font-mono text-sm font-bold text-white"
                  style={{ background: taken ? colorAt(left.findIndex(l => pairs[l.id] === r.id)) : 'var(--c-canvas)', color: taken ? '#ffffff' : 'var(--c-muted)' }}
                >
                  {String.fromCharCode(65 + ri)}
                </span>
                <span className="min-w-0 flex-1 break-words leading-snug">{r.text}</span>
                {taken && <span className="shrink-0 font-mono text-xs text-muted" aria-hidden>✓</span>}
              </button>
            )
          })}
        </div>
      </div>

      {Object.keys(pairs).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted">Pasangan terbentuk:</p>
          <ul className="space-y-1">
            {left
              .filter(l => pairs[l.id])
              .map(l => {
                const i = leftIndexById(l.id)
                const ri = right.findIndex(r => r.id === pairs[l.id])
                return (
                  <li key={l.id} className="flex items-center gap-2 text-sm">
                    <span
                      className="flex min-w-16 items-center justify-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                      style={{ background: colorAt(i) }}
                    >
                      {i + 1} ↔ {String.fromCharCode(65 + ri)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted">
                      {l.text} ↔ {right[ri]?.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => unpair(l.id)}
                      disabled={disabled}
                      aria-label={`Lepas pasangan ${i + 1}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-strong text-muted active:scale-[0.97] hover:bg-canvas disabled:opacity-40"
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
  q: FetchedQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  const text = typeof value === 'string' ? value : ''
  // pertanyaan bermuatan angka → keyboard numerik (helpertanpa mengubah jawaban)
  const numeric = /\b(hitung|jumlah|hasil|berapa)\b/i.test(String(q.body ?? ''))
  return (
    <div className="space-y-1.5">
      <input
        className="input font-mono text-lg tracking-wide"
        value={text}
        disabled={disabled}
        placeholder="Ketik jawabanmu…"
        aria-label="Jawaban singkat"
        inputMode={numeric ? 'numeric' : undefined}
        onChange={e => onChange(e.target.value)}
      />
      <p className="text-xs text-muted">
        {numeric ? 'Tulis angka saja, tanpa titik pemisah ribuan (contoh: 1250).' : 'Perhatikan ejaan — jawaban dibandingkan persis.'}
      </p>
    </div>
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
  q?: FetchedQuestion
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}) {
  const text = typeof value === 'string' ? value : ''
  let bytes = 0
  try {
    bytes = new Blob([text]).size
  } catch {
    bytes = text.length
  }
  const nearLimit = bytes > MAX_ESSAY_BYTES - 2 * 1024
  return (
    <div className="space-y-1.5">
      <textarea
        className="input min-h-40 resize-y"
        style={{ fontSize: 16, lineHeight: 1.6 }}
        value={text}
        disabled={disabled}
        placeholder="Tulis jawabanmu di sini…"
        aria-label="Jawaban uraian"
        onChange={e => onChange(clampEssay(e.target.value))}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">Jawaban panjang — batas 20 KB.</span>
        <span className={`font-mono tabular-nums ${nearLimit ? 'text-warn' : 'text-muted'}`}>
          {text.length.toLocaleString('id-ID')} karakter
        </span>
      </div>
    </div>
  )
}

/* ------------------------ stimulus (wacana) pelipat ------------------------ */

/** Stimulus/wacana collapsible — TERSANITASI via renderSimpleHtml (XSS-safe). */
export function StimulusCard({ text, title = 'Wacana' }: { text?: string | null; title?: string }) {
  const [open, setOpen] = useState(true)
  if (!text) return null
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className="text-muted">
            <path d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
            <path d="M14 4v4h4M9 12h6M9 16h4" />
          </svg>
          {title}
        </span>
        <span aria-hidden className="font-mono text-xs text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div
          className="whitespace-pre-wrap border-t border-border px-3 py-3 leading-relaxed"
          // hanya tag allowlist tanpa atribut (PRD §12) — body/stimulus dari guru
          dangerouslySetInnerHTML={{ __html: renderSimpleHtml(text) }}
        />
      )}
    </div>
  )
}
