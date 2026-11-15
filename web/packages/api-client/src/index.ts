// Klien API terpusat (semua akses jaringan lewat sini — konvensi PRD 18.7).
import React from 'react';
import { useMutation, useQuery, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const BASE = (import.meta as any).env?.VITE_API_BASE || 'http://127.0.0.1:8080/api/v1';

let accessToken: string | null = null;
export function setAccessToken(t: string | null) { accessToken = t; }
export function getAccessToken() { return accessToken; }

export interface ApiError { code: string; message: string; details?: unknown }

export async function api<T>(method: string, path: string, body?: unknown, opts: { token?: boolean; headers?: Record<string, string>; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.token !== false && accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const e: ApiError = json?.error || { code: 'HTTP_' + res.status, message: String(json || res.statusText) };
    throw e;
  }
  return (json?.data !== undefined ? json.data : json) as T;
}

export function useApiQuery<T>(key: unknown[], path: string, opts: { enabled?: boolean } = {}) {
  return useQuery<T>({ queryKey: key, queryFn: () => api<T>('GET', path), enabled: opts.enabled !== false });
}

export function useApiMutation<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries() });
}

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });
}

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(() => makeQueryClient());
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

export { useQuery, useMutation, useQueryClient };
export const API_BASE = BASE;
