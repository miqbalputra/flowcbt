// API client — Bearer JWT + auto refresh (PRD FR-1.6)
export const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const BASE = API_BASE

const TOKEN_KEY = 'flowcbt.access'
const REFRESH_KEY = 'flowcbt.refresh'

export function getAccessToken() { return localStorage.getItem(TOKEN_KEY) || '' }
export function getRefreshToken() { return localStorage.getItem(REFRESH_KEY) || '' }
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}
export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export type ApiError = { status: number; code: string; message: string; details?: unknown }

let refreshing: Promise<string> | null = null

async function tryRefresh(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const rt = getRefreshToken()
      if (!rt) throw { status: 401, code: 'UNAUTHORIZED', message: 'Sesi berakhir' }
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      })
      if (!res.ok) throw { status: 401, code: 'UNAUTHORIZED', message: 'Sesi berakhir' }
      const data = await res.json()
      setTokens(data.access_token, data.refresh_token)
      return data.access_token as string
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

// logoutBersih: sesi tak bisa dipulihkan → bersihkan & kembali ke login
// (guru: /login, siswa: /s/login).
function logoutBersih() {
  clearTokens()
  const target = location.pathname.startsWith('/s/') ? '/s/login' : '/login'
  if (!location.pathname.startsWith(target)) location.assign(target)
}

type Opts = Omit<RequestInit, 'body'> & { body?: unknown; raw?: boolean; auth?: boolean; timeoutMs?: number }

// timeoutSignal: batas waktu fetch agar tidak menggantung selamanya saat
// jaringan buruk (default 20 dtk; upload/export boleh lebih lama via opts).
function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, done: () => clearTimeout(t) }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, timeoutMs = 20_000, ...rest } = opts
  const doFetch = async (token: string | null) => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(headers as Record<string, string>),
    }
    if (token) h.Authorization = `Bearer ${token}`
    const { signal, done } = timeoutSignal(timeoutMs)
    try {
      return await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
        ...rest,
      })
    } finally {
      done()
    }
  }

  const jejakGagalNet = (e: unknown): ApiError => {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { status: 0, code: 'TIMEOUT', message: 'Koneksi lambat — periksa jaringan lalu coba lagi.' }
    }
    return { status: 0, code: 'NETWORK', message: 'Tidak ada koneksi — periksa internet lalu coba lagi.' }
  }

  let token = getAccessToken()
  let res: Response
  try {
    res = await doFetch(token || null)
  } catch (e) {
    // GET bersifat idempoten → satu kali retry otomatis saat jaringan putus.
    if (method === 'GET') {
      await sleep(800)
      try {
        res = await doFetch(token || null)
      } catch (e2) { throw jejakGagalNet(e2) }
    } else {
      throw jejakGagalNet(e)
    }
  }
  if (res.status === 401 && getRefreshToken() && !path.startsWith('/auth/')) {
    try {
      token = await tryRefresh()
    } catch {
      logoutBersih()
      throw { status: 401, code: 'SESSION_EXPIRED', message: 'Sesi berakhir — silakan masuk kembali.' }
    }
    try {
      res = await doFetch(token)
    } catch (e) { throw jejakGagalNet(e) }
  }
  if (!res.ok) {
    let err: ApiError
    try {
      const j = await res.json()
      err = { status: res.status, code: j.code || 'ERROR', message: j.message || 'Terjadi kesalahan', details: j.details }
    } catch {
      err = { status: res.status, code: 'ERROR', message: `Kesalahan ${res.status}` }
    }
    if (res.status === 401) logoutBersih()
    throw err
  }
  if (res.status === 204) return undefined as T
  try {
    return await res.json()
  } catch {
    throw { status: res.status, code: 'BAD_RESPONSE', message: 'Balasan server tidak valid' }
  }
}

export function onOnline(cb: () => void) {
  window.addEventListener('online', cb)
  return () => window.removeEventListener('online', cb)
}
