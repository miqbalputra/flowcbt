// useLiveStream — hook EventSource untuk laporan real-time (PRD FR-9.3).
//
// Membuka SSE ke `/reports/live/stream` (token via query, karena EventSource
// tidak bisa mengirim header). Setiap event `snapshot` dikirim ke onData.
// Ketangguhan:
//  - tiap (re)koneksi membaca token TERBARU (setelah refresh tidak 401 loop);
//  - kegagalan beruntun → fallback polling, lalu cooldown dan coba SSE lagi
//    (jangan jadi polling permanen hanya karena proxy sekali gagal);
//  - event `reconnect` dari server (batas sesi) → sambung ulang segera.
import { useEffect, useRef, useState } from 'react'
import { API_BASE, getAccessToken } from './api'

export type LiveStreamStatus = 'connecting' | 'live' | 'polling'

const MAX_ERRORS = 4           // kegagalan beruntun → fallback polling
const COOLDOWN_MS = 2 * 60_000 // jeda sebelum mencoba SSE lagi setelah fallback

export function useLiveStream(
  path: string,
  params: Record<string, string>,
  onData: (data: unknown) => void,
  enabled = true,
): LiveStreamStatus {
  const [status, setStatus] = useState<LiveStreamStatus>('connecting')
  const dataRef = useRef(onData)
  dataRef.current = onData

  // Stabilkan query string agar effect tidak jalan berulang.
  const qs = new URLSearchParams(params).toString()
  const qsRef = useRef(qs)
  qsRef.current = qs

  useEffect(() => {
    if (!enabled) {
      setStatus((s) => (s === 'connecting' ? 'polling' : s))
      return
    }
    let es: EventSource | null = null
    let errors = 0
    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (closed) return
      const token = getAccessToken() // token TERKINI saat tiap (re)koneksi
      const url = `${API_BASE}${path}?token=${encodeURIComponent(token)}&${qsRef.current}`
      es = new EventSource(url)

      es.addEventListener('snapshot', ev => {
        errors = 0
        setStatus('live')
        try {
          dataRef.current(JSON.parse((ev as MessageEvent).data))
        } catch {
          /* snapshot rusak — tunggu snapshot berikutnya */
        }
      })
      es.addEventListener('reconnect', () => {
        // server menutup (batas sesi) — sambung ulang segera dengan token baru
        es?.close()
        if (!closed) reconnectTimer = setTimeout(connect, 300)
      })
      es.addEventListener('error', () => {
        errors++
        es?.close()
        if (closed) return
        if (errors >= MAX_ERRORS) {
          // fallback polling + cooldown, lalu pencobaan SSE kembali dari nol
          setStatus('polling')
          reconnectTimer = setTimeout(() => {
            if (closed) return
            errors = 0
            setStatus('connecting')
            connect()
          }, COOLDOWN_MS)
        } else {
          // mundur singkat antar percobaan (retry EventSource bawaan juga aktif)
          reconnectTimer = setTimeout(connect, 1000 * errors)
        }
      })
    }

    connect()
    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [path, qs, enabled])

  return status
}
