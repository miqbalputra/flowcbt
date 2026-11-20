// Router Area Siswa — semua jalur /s/* berbagi layout mobile-first.
import { Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import Guest from './pages/Guest'
import Dashboard from './pages/Dashboard'
import Start from './pages/Start'
import Attempt from './pages/Attempt'
import Review from './pages/Review'
import Done from './pages/Done'
import History from './pages/History'

export default function SiswaRoutes() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="guest" element={<Guest />} />
      <Route path="exams" element={<Dashboard />} />
      <Route path="exams/:id/start" element={<Start />} />
      <Route path="attempt/:id" element={<Attempt />} />
      <Route path="attempt/:id/review" element={<Review />} />
      <Route path="attempt/:id/done" element={<Done />} />
      <Route path="history" element={<History />} />
    </Routes>
  )
}
