// Proktor kamera (FR-5.8B) — snapshot berkala acak 30–90 dtk, resolusi rendah
// (JPEG kecil). Tanpa rekaman video/audio. Offline: foto masuk antrean
// IndexedDB ("photos") dan dikirim SETELAH jawaban terkirim (prioritas
// diatur engine sync). Hasil capture dikonsumsi drainPhotos() di sync.ts.
import { savePhoto } from '../db'
import { kick } from './sync'
import { uuid } from './util'

export function startProctor(attemptId: string): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stream: MediaStream | null = null

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(video)

  navigator.mediaDevices
    ?.getUserMedia({ video: { width: 320 }, audio: false })
    .then(s => {
      if (stopped) {
        s.getTracks().forEach(t => t.stop())
        return
      }
      stream = s
      video.srcObject = s
      video.play().catch(() => undefined)
      schedule()
    })
    .catch(() => undefined) // izin ditolak → tanpa snapshot (dilaporkan server dari log konsent)

  function schedule() {
    if (stopped) return
    timer = setTimeout(take, 30000 + Math.random() * 60000) // 30–90 dtk acak
  }

  async function take() {
    if (stopped) return
    try {
      if (video.videoWidth > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * 320))
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
        await savePhoto({ id: uuid(), attempt_id: attemptId, data_url: dataUrl, taken_at: Date.now() })
      }
    } catch {
      //abaikan kegagalan satu snapshot
    }
    schedule()
  }

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    stream?.getTracks().forEach(t => t.stop())
    video.remove()
  }
}
