// Komponen soal Area Siswa — kartu opsi gaya lembar ujian nasional (directive §2A).
// - Kartu full-width, klik di mana saja pada kartu memilih; target sentuh ≥ 48px.
// - Kotak huruf A–E font-mono 32px; terpilih = border-2 primary + tint primary-soft.
// - Matching tetap tap-pilih kiri→kanan dengan warna pasangan (PAIR_COLORS).
// Kontrak LAMA dipertahankan: prop (q, value, onChange, disabled) + AnswerValue.
import { useState } from 'react'
import type { FetchedQuestion } from '../types'
import { htmlToText, renderRich } from '@/lib/sanitize'
import {
  IconBook,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconSwap,
  IconX,
} from '@/components/icons'

/** Bentuk jawaban lintas tipe: string, string[], atau map pasangan matching. */
export type AnswerValue = string | string[] | Record<string, string> | null

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/* --------------------------- primitif visual --------------------------- */

/** Kotak huruf 32px font-mono — indikator pilihan (terpilih = peril strip biru). */
function LetterBox({ letter, active }: { letter: string; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`mono flex h-8 w-8 shrink-0 items-center justify-center rounded border text-[13px] font-bold transition-colors ${
        active ? 'border-primary bg-primary-bg text-primary-fg' : 'border-border-strong bg-canvas text-text'
      }`}
    >
      {letter}
    </span>
  )
}

/** Penanda pilihan di sisi kanan kartu — radio (PG) / kotak centang (kompleks). */
function ChoiceMark({ active, multiple = false }: { active: boolean; multiple?: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center border-[1.5px] transition-colors ${
        multiple ? 'rounded-[4px]' : 'rounded-full'
      } ${active ? 'border-primary bg-primary text-white' : 'border-border-strong bg-surface'}`}
    >
      {active && (multiple ? <IconCheck size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />)}
    </span>
  )
}

/** Kelas kartu opsi (MCQ & kompleks): border-2 jelas, radius lg, 48px, tekan 0.99. */
function cardCls(active: boolean, disabled?: boolean): string {
  return [
    'flex w-full items-start gap-3 rounded-md border p-3 text-left min-h-12',
    'transition-[background-color,border-color,box-shadow] active:scale-[0.99]',
    disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
    active
      ? 'border-primary bg-primary-soft shadow-[inset_3px_0_0_0_var(--c-primary)]'
      : 'border-border-strong bg-surface hover:border-primary/60 hover:bg-canvas',
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
            <span className="min-w-0 flex-1 break-words leading-relaxed">{htmlToText(o.text) || `Pilihan ${LETTERS[i]}`}</span>
            <ChoiceMark active={active} />
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
            <LetterBox letter={LETTERS[i] ?? '·'} active={active} />
            <span className="min-w-0 flex-1 break-words leading-relaxed">{htmlToText(o.text) || `Pilihan ${LETTERS[i]}`}</span>
            <ChoiceMark active={active} multiple />
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
                className={`flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left min-h-12
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
                  {htmlToText(l.text)}
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
                className={`flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left min-h-12
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
                <span className="min-w-0 flex-1 break-words leading-snug">{htmlToText(r.text)}</span>
                {taken && <IconCheck size={12} className="shrink-0 text-muted" />}
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
                      {i + 1} <IconSwap size={10} className="inline-block align-[-1px]" /> {String.fromCharCode(65 + ri)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted">
                      {htmlToText(l.text)} <IconSwap size={11} className="inline-block align-[-1px]" /> {htmlToText(right[ri]?.text ?? '')}
                    </span>
                    <button
                      type="button"
                      onClick={() => unpair(l.id)}
                      disabled={disabled}
                      aria-label={`Lepas pasangan ${i + 1}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-strong text-muted active:scale-[0.97] hover:bg-canvas disabled:opacity-40"
                    >
                      <IconX size={14} />
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

/** Stimulus/wacana collapsible — teks/format guru → HTML aman via renderRich (XSS-safe). */
export function StimulusCard({ text, title = 'Wacana' }: { text?: string | null; title?: string }) {
  const [open, setOpen] = useState(true)
  if (!text) return null
  return (
    <div className="mb-4 overflow-hidden rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 border-b border-border bg-canvas px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <IconBook size={15} className="shrink-0 text-muted" />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{title}</span>
        </span>
        <span aria-hidden className="text-muted">{open ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}</span>
      </button>
      {open && (
        <div
          className="rich-text px-3.5 py-3 leading-relaxed"
          // teks & format dari guru dibersihkan renderRich (allowlist, PRD §12)
          dangerouslySetInnerHTML={{ __html: renderRich(text) }}
        />
      )}
    </div>
  )
}
