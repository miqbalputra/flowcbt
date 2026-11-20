// Helper kecil bersama Area Siswa — tanpa state.
import { fmtClock, fmtDateTime } from '../types'

export { fmtClock, fmtDateTime }

/** UUID v4 — identitas per event/attempt (idempotensi AC-3). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return (
    Date.now().toString(16) +
    '-' +
    Math.random().toString(16).slice(2, 10) +
    '-' +
    Math.random().toString(16).slice(2, 10)
  )
}

/** Pesan ramah dari exception api()/fetch — dipakai halaman. */
export function errMessage(e: unknown): string {
  const err = e as { message?: string }
  if (err?.message?.includes('Failed to fetch')) return 'Tidak ada koneksi internet. Periksa jaringanmu lalu coba lagi.'
  return err?.message || 'Terjadi kesalahan. Coba lagi.'
}

/** Unwrap {data: ...} dari respons API agar toleran perubahan backend. */
export function unwrap<T>(r: unknown): T | null {
  if (r && typeof r === 'object' && 'data' in (r as Record<string, unknown>)) {
    const d = (r as { data?: unknown }).data
    return (d ?? null) as T | null
  }
  return (r ?? null) as T | null
}
