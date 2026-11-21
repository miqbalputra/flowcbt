// Helper data bersama area guru: parsing defensively (backend bisa mati → FE tetap render),
// format Rupiah/tanggal, konstanta PRD.
import type { ComponentType } from 'react'
import { IconGrid, IconCheck, IconSwap, IconKey, IconEdit } from '@/components/icons'
import type { ApiError } from '@/lib/api'
import { toast } from '@/components/toast'

/** Bentuk longgar — bentuk respons backend tidak selalu diketahui pasti di FE */
export type Dict = Record<string, any>

export type Ico = ComponentType<{ size?: number; className?: string }>

export const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {})
export const asList = (v: unknown): Dict[] => {
  if (Array.isArray(v)) return v.map(asDict)
  return []
}
/** {data: ...} → isi data; sudah objek → apa adanya */
export function unwrap(res: unknown): Dict {
  const o = asDict(res)
  return o.data !== undefined ? asDict(o.data) : o
}
/** rows & cursor dari hasil useQuery yang datanya {rows, next} */
export const qRows = (q: unknown): Dict[] => {
  const o = asDict((q as { data?: unknown })?.data)
  return Array.isArray(o.rows) ? o.rows.map(asDict) : []
}
export const qNext = (q: unknown): string | null => {
  const o = asDict((q as { data?: unknown })?.data)
  return typeof o.next === 'string' ? o.next : null
}

/** {data:[...], next_cursor?} → rows + cursor */
export function unwrapList(res: unknown): { rows: Dict[]; next: string | null } {
  const o = asDict(res)
  const raw = o.data !== undefined ? o.data : o
  const rows = Array.isArray(raw) ? raw.map(asDict) : []
  const next = [o.next_cursor, asDict(raw).next_cursor].find(v => typeof v === 'string')
  return { rows, next: (next as string) ?? null }
}

export function errMessage(e: unknown): string {
  const m = e as Partial<ApiError>
  return m?.message || 'Terjadi kesalahan, coba lagi'
}
export const errCode = (e: unknown): string => (e as Partial<ApiError>)?.code || 'ERROR'

/** Rp10.000 (PRD §11) */
export function fmtRp(n: unknown): string {
  const num = Number(n)
  if (!Number.isFinite(num)) return 'Rp0'
  return 'Rp' + num.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
export function fmtDate(s: unknown): string {
  const d = new Date(String(s ?? ''))
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}
export function fmtDateTime(s: unknown): string {
  const d = new Date(String(s ?? ''))
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
}
/** durasi detik → "12 menit 30 detik" */
export function fmtDuration(seconds: unknown): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r} detik`
  return r === 0 ? `${m} menit` : `${m} mnt ${r} dtk`
}
export const pct = (n: unknown): string => `${Math.round(Number(n) || 0)}%`

/** gabung query params; abaikan kosong/undefined */
export function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

// ---- Konstanta PRD (FR-4.3, FR-1.1, FR-5.5) ----

export type QType = 'pg' | 'pg_kompleks' | 'menjodohkan' | 'isian' | 'uraian'

export const QTYPES: { value: QType; label: string; ico: Ico }[] = [
  { value: 'pg', label: 'Pilihan Ganda', ico: IconGrid },
  { value: 'pg_kompleks', label: 'PG Kompleks', ico: IconCheck },
  { value: 'menjodohkan', label: 'Menjodohkan', ico: IconSwap },
  { value: 'isian', label: 'Isian Singkat', ico: IconKey },
  { value: 'uraian', label: 'Uraian', ico: IconEdit },
]
export const qtypeLabel = (t: unknown) => QTYPES.find(q => q.value === t)?.label ?? String(t ?? '—')
/** komponen ikon tipe soal (tanpa emoji) */
export const qtypeIco = (t: unknown): Ico => QTYPES.find(q => q.value === t)?.ico ?? IconEdit

export const SCHOOL_LEVELS = ['PAUD/TK', 'SD/MI', 'SMP/MTs', 'SMA/SMK/MA', 'Perguruan Tinggi', 'Kursus/Bimbel', 'Lainnya']
export const GENDERS = ['L', 'P']
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Admin Sekolah',
  teacher: 'Guru',
  superadmin: 'Super Admin',
}

/** status attempt → teks & warna badge soft (PRD 18.3, directive §3A: bg *-soft + teks status) */
export function attemptStatus(s: unknown): { label: string; cls: string } {
  const v = String(s ?? '')
  switch (v) {
    case 'in_progress': return { label: 'Mengerjakan', cls: 'bg-primary-soft text-primary' }
    case 'working': return { label: 'Mengerjakan', cls: 'bg-primary-soft text-primary' }
    case 'submitted': return { label: 'Selesai', cls: 'bg-success-soft text-success' }
    case 'done': return { label: 'Selesai', cls: 'bg-success-soft text-success' }
    case 'pending': return { label: 'Belum Mulai', cls: 'badge-soft text-muted' }
    case 'not_started': return { label: 'Belum Mulai', cls: 'badge-soft text-muted' }
    case 'expired': return { label: 'Waktu Habis', cls: 'bg-warn-soft text-warn' }
    case 'forced_submit': return { label: 'Dipaksa Selesai', cls: 'bg-warn-soft text-warn' }
    case 'disqualified': return { label: 'Diskualifikasi', cls: 'bg-danger-soft text-danger' }
    case 'graded': return { label: 'Sudah Dinilai', cls: 'bg-success-soft text-success' }
    case 'needs_grading': return { label: 'Perlu Nilai Uraian', cls: 'bg-warn-soft text-warn' }
    default: return { label: v || '—', cls: 'badge-soft text-muted' }
  }
}

/** badge status umum (draft/published dsb) — gaya soft, konsisten dark mode */
export function statusBadge(s: unknown): { label: string; cls: string } {
  const v = String(s ?? '')
  switch (v) {
    case 'draft': return { label: 'Draft', cls: 'badge-soft text-muted' }
    case 'published': return { label: 'Published', cls: 'bg-success-soft text-success' }
    case 'archived': return { label: 'Arsip', cls: 'badge-soft text-muted' }
    case 'paid': return { label: 'Lunas', cls: 'bg-success-soft text-success' }
    case 'pending': return { label: 'Menunggu', cls: 'bg-warn-soft text-warn' }
    case 'expired': return { label: 'Kedaluwarsa', cls: 'bg-danger-soft text-danger' }
    case 'active': return { label: 'Aktif', cls: 'bg-success-soft text-success' }
    case 'trialing': return { label: 'Masa Coba', cls: 'bg-warn-soft text-warn' }
    case 'canceled': return { label: 'Dibatalkan', cls: 'bg-danger-soft text-danger' }
    default: return { label: v || '—', cls: 'badge-soft text-muted' }
  }
}

/** Teks soal menerima HTML sederhana — sanitize whitelist tags (v1 textarea, tanpa editor berat) */
const HTML_TAGS = ['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'sub', 'sup', 'code']
export function renderSimpleHtml(raw: string): string {
  let s = (raw || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (const t of HTML_TAGS) {
    s = s.replace(new RegExp(`&lt;(/?)${t}&gt;`, 'gi'), `<$1${t}>`)
  }
  return s
}

/** salin ke clipboard + toast */
export async function copyText(text: string, successMsg = 'Disalin ke clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast(successMsg, 'success')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    toast(successMsg, 'success')
  }
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E']
