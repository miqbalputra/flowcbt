// /s/guest kini MENAMPILKAN dua tab yang sama dengan /s/login, langsung
// pada tab Kartu Ujian (kompatibilitas deep-link dari footer kartu PDF
// lama & WhatsApp). Muatan form di reuse dari GuestForm.
import { useSearchParams } from 'react-router-dom'
import { Navigate } from 'react-router-dom'

export default function Guest() {
  const [params] = useSearchParams()
  // pertahankan parameter lain (mis. invite/kode) bila ada
  const qs = params.toString()
  return <Navigate to={`/s/login?jalur=kartu${qs ? '&' + qs : ''}`} replace />
}
