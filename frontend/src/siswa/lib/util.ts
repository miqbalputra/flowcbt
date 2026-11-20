// Helper kecil bersama Area Siswa — tanpa state.
import { fmtClock, fmtDateTime, type StudentProfile } from '../types'

export { fmtClock, fmtDateTime }

/* ------------------------- profil lokal (UI pill) ------------------------ */
// Nama/NIS disimpan ringan di localStorage saat login — dipakai Attempt untuk
// pill profil di header. TIDAK bagian dari logika sinkron (hanya tampilan).
const PROFILE_KEY = 'flowcbt.profile'

export function saveLocalProfile(raw: unknown): void {
  try {
    const o = (raw ?? {}) as Record<string, unknown>
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Siswa'
    const sid =
      typeof o.sid === 'string' ? o.sid :
      typeof o.nis === 'string' ? o.nis :
      typeof o.username === 'string' ? o.username : ''
    const p: StudentProfile = { name, sid, isGuest: Boolean(o.isGuest) }
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    /* penyimpanan tak tersedia — pill tampil generik */
  }
}

export function getProfile(): StudentProfile {
  try {
    const v = localStorage.getItem(PROFILE_KEY)
    if (v) {
      const p = JSON.parse(v) as StudentProfile
      if (p && typeof p.name === 'string' && p.name) return p
    }
  } catch {
    /* fallback di bawah */
  }
  return { name: 'Siswa' }
}

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
