// Upload FormData & download blob — api() di lib/api.ts hanya meng-cover body JSON,
// jadi dua helper kecil ini memakai token yang sama dari lib/api (satu-satunya pengecualian fetch manual).
import { getAccessToken } from '@/lib/api'
import type { ApiError } from '@/lib/api'

const BASE = import.meta.env.VITE_API_URL || '/api/v1'

export const apiUrl = (path: string) => `${BASE}${path}`

async function throwErr(res: Response): Promise<never> {
  let err: ApiError = { status: res.status, code: 'ERROR', message: `Kesalahan ${res.status}` }
  try {
    const j = await res.json()
    err = { status: res.status, code: j.code || 'ERROR', message: j.message || `Kesalahan ${res.status}` }
  } catch { /* body bukan JSON — pakai pesan generik */ }
  throw err
}

/** POST FormData (import siswa, upload file) */
export async function uploadFile(path: string, file: File): Promise<Record<string, any>> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    body: fd,
  })
  if (!res.ok) await throwErr(res)
  return res.json()
}

/** unduh file (xlsx/csv) dengan Authorization header */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })
  if (!res.ok) await throwErr(res)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
