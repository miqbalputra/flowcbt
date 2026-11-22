// /s/guest kini redirect ke /s/login — tab default (kiri) sudah Kartu
// Ujian, jadi deep-link dari footer kartu PDF lama & WhatsApp tetap
// sampai ke form kartu tanpa parameter tambahan.
import { Navigate } from 'react-router-dom'

export default function Guest() {
  return <Navigate to="/s/login" replace />
}
