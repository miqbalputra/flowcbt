// Klien API terpusat (semua akses jaringan lewat sini — konvensi PRD 18.7).
// Access token di memori; refresh token aman di localStorage dengan rotasi otomatis:
// fetch gagal 401 → refresh sekali (single-flight) → ulangi request asli sekali.
import React from 'react';
import { useMutation, useQuery, useQueryClient, QueryClient, QueryCache, QueryClientProvider } from '@tanstack/react-query';
import { Card, Badge, useToast } from '@flowcbt/ui';

const BASE = (import.meta as any).env?.VITE_API_BASE || 'http://127.0.0.1:8080/api/v1';
const REFRESH_KEY = 'flowcbt-refresh';

let accessToken: string | null = null;
export function setAccessToken(t: string | null) { accessToken = t; }
export function getAccessToken() { return accessToken; }

export function getRefreshToken(): string | null {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
}
export function setRefreshToken(t: string | null) {
  try {
    if (t) localStorage.setItem(REFRESH_KEY, t);
    else localStorage.removeItem(REFRESH_KEY);
  } catch { /* storage penuh / mode privat */ }
}

export interface ApiError { code: string; message: string; details?: unknown }

// ---- Rotasi refresh token (single-flight) ----
let refreshPromise: Promise<boolean> | null = null;

function parseErr(res: Response, text: string): ApiError {
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return json?.error || { code: 'HTTP_' + res.status, message: String(json || res.statusText) };
}

async function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const rt = getRefreshToken();
      if (!rt) return false;
      try {
        const res = await fetch(BASE + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        const text = await res.text();
        if (!res.ok) {
          // refresh ditolak (reuse/expired) → sesi benar-benar berakhir
          accessToken = null;
          setRefreshToken(null);
          return false;
        }
        let json: any = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        const tokens = json?.data?.tokens ?? json?.tokens;
        accessToken = tokens?.access_token ?? null;
        if (tokens?.refresh_token) setRefreshToken(tokens.refresh_token);
        return !!accessToken;
      } catch {
        return false; // offline: jangan buang refresh token, coba lagi nanti
      }
    })();
  }
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export type ApiOpts = { token?: boolean; headers?: Record<string, string>; raw?: boolean };

async function rawFetch(method: string, path: string, body?: unknown, opts: ApiOpts = {}, retried = false): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.token !== false && !accessToken && getRefreshToken() && !retried) {
    await refreshOnce();
  }
  if (opts.token !== false && accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && opts.token !== false && getRefreshToken() && !retried) {
    // 401: coba refresh lalu ulangi request asli sekali (interceptor)
    const ok = await refreshOnce();
    if (ok) return rawFetch(method, path, body, opts, true);
  }
  return res;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: ApiOpts = {}): Promise<T> {
  const res = await rawFetch(method, path, body, opts);
  const text = await res.text();
  if (!res.ok) throw parseErr(res, text);
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return (json?.data !== undefined ? json.data : json) as T;
}

// Pulihkan sesi saat aplikasi dibuka: bila ada refresh token, tukar ke access token
// (rotasi) sebelum render pertama. Aman dipanggil saat offline (return false cepat).
export async function restoreSession(): Promise<boolean> {
  if (accessToken) return true;
  if (!getRefreshToken()) return false;
  return refreshOnce();
}

// Logout gabungan: revoke refresh token di server (idempoten) lalu bersihkan klien.
export async function logout() {
  const rt = getRefreshToken();
  if (rt) { await api('POST', '/auth/logout', { refresh_token: rt }, { token: false }).catch(() => {}); }
  accessToken = null;
  setRefreshToken(null);
}

export function useApiQuery<T>(key: unknown[], path: string, opts: { enabled?: boolean } = {}) {
  return useQuery<T>({ queryKey: key, queryFn: () => api<T>('GET', path), enabled: opts.enabled !== false });
}

export function useApiMutation<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries() });
}

export const QUERY_ERR_EVENT = 'flowcbt:query-error';

export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      // error query diberitahukan global (toast), kecuali 401 (interceptor/sesi menanganinya)
      onError: (err) => {
        const e = err as unknown as ApiError;
        const code = e?.code;
        if (code === 'HTTP_401' || code === 'UNAUTHORIZED' || code === 'OFFLINE') return;
        window.dispatchEvent(new CustomEvent(QUERY_ERR_EVENT, { detail: e }));
      },
    }),
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
  });
}

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(() => makeQueryClient());
  return <QueryClientProvider client={qc}>{children}<QueryErrorToast /></QueryClientProvider>;
}

// Pasang sekali di ApiProvider: toast untuk semua query yang gagal.
function QueryErrorToast() {
  const toast = useToast();
  React.useEffect(() => {
    const h = (ev: Event) => {
      const e = (ev as CustomEvent).detail as ApiError;
      toast(e?.message || 'Gagal memuat data', 'danger');
    };
    window.addEventListener(QUERY_ERR_EVENT, h);
    return () => window.removeEventListener(QUERY_ERR_EVENT, h);
  }, [toast]);
  return null;
}

// ---- State utilitas untuk halaman: loading & error konsisten ----
export function QueryLoading({ label = 'Memuat…' }: { label?: string }) {
  return <Card><span style={{ color: 'var(--muted)' }}>{label}</span></Card>;
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as ApiError | null;
  const msg = e?.message || 'Terjadi kesalahan.';
  const auth = e?.code === 'HTTP_401' || e?.code === 'UNAUTHORIZED';
  return (
    <Card style={{ borderColor: 'var(--danger)' }}>
      <Badge tone="danger">{auth ? 'Sesi berakhir' : 'Gagal memuat'}</Badge>
      <div style={{ marginTop: 8, fontSize: 14 }}>{auth ? 'Silakan login ulang.' : msg}</div>
      {onRetry && !auth && <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onRetry}>Coba lagi</button>}
    </Card>
  );
}

export { useQuery, useMutation, useQueryClient };
export const API_BASE = BASE;
