// Wrapper bertipe di atas lib/api.ts — body JSON dikirim apa adanya,
// menghindari interseksi tipe body & RequestInit pada Opts lib/api (yang menolak objek JSON).
// GET tanpa body tetap pakai api() langsung.
import { api } from '@/lib/api'
import { asDict, type Dict } from './types'

export { apiUrl } from './files'

/** POST/PUT dengan body JSON — respons lengkap: {data}, atau {data:[...], next_cursor} utk list */
export function send<T = Dict>(path: string, body?: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  return api<T>(path, { method, body: body as never })
}

/** {data:{...}} → isi data (sudah asDict) */
export const unwrapRpc = (res: unknown): Dict => {
  const o = asDict(res)
  return o.data !== undefined ? asDict(o.data) : o
}
