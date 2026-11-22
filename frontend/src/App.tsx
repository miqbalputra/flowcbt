// Router area guru/admin — dipasang di sini sesuai sitemap PRD §11.1
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ThemeToggle } from './components/ThemeToggle'
import ProtectedLayout from './guru/layout'
import Login from './guru/auth/login'
import Register from './guru/auth/register'
import Forgot from './guru/auth/forgot'
import Reset from './guru/auth/reset'
import Dashboard from './guru/dashboard'
import Classes from './guru/classes'
import Students from './guru/students'
import StudentDetail from './guru/students/detail'
import Qsets from './guru/qsets'
import QsetEditor from './guru/qsets/editor'
import Exams from './guru/exams'
import ExamWizard from './guru/exams/wizard'
import ExamDetail from './guru/exams/detail'
import ExamCheating from './guru/exams/cheating'
import ExamGrading from './guru/exams/grading'
import ExamCards from './guru/exams/cards'
import ReportsHome from './guru/reports'
import ReportsLive from './guru/reports/live'
import ReportLiveExam from './guru/reports/live-detail'
import ReportsHistory from './guru/reports/history'
import ReportExam from './guru/reports/exam'
import Billing from './guru/billing'
import Settings from './guru/settings'
import SiswaRoutes from './siswa/SiswaRoutes'

// Halaman fondasi — sistem fitur dipasang bertahap
export default function App() {
  const loc = useLocation()
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {/* area auth terpisah */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<Forgot />} />
      <Route path="/reset-password" element={<Reset />} />

      {/* area guru (protected) */}
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/classes" element={<Classes />} />
        <Route path="/students" element={<Students />} />
        <Route path="/students/:id" element={<StudentDetail />} />
        <Route path="/question-sets" element={<Qsets />} />
        <Route path="/question-sets/:id/edit" element={<QsetEditor />} />
        <Route path="/exams" element={<Exams />} />
        <Route path="/exams/new" element={<ExamWizard />} />
        <Route path="/exams/:id" element={<ExamDetail />} />
        <Route path="/exams/:id/cheating" element={<ExamCheating />} />
        <Route path="/exams/:id/grading" element={<ExamGrading />} />
        <Route path="/exams/:id/cards" element={<ExamCards />} />
        <Route path="/reports" element={<ReportsHome />} />
        <Route path="/reports/live" element={<ReportsLive />} />
        <Route path="/reports/live/:examId" element={<ReportLiveExam />} />
        <Route path="/reports/history" element={<ReportsHistory />} />
        <Route path="/reports/exams/:id" element={<ReportExam />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* area siswa (mobile-first, offline-first) */}
      <Route path="/s/*" element={<SiswaRoutes />} />

      <Route
        path="*"
        element={
          <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
            <div className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-surface p-5 text-center shadow-xs">
              <div className="mono text-xs font-bold uppercase tracking-[0.14em] text-muted">404</div>
              <div className="text-lg font-bold tracking-tight">Halaman tidak ditemukan</div>
              <p className="text-sm text-muted">Tautan mungkin sudah dipindahkan atau tidak lagi tersedia.</p>
              <Link to={loc.pathname.startsWith('/s/') ? '/s/exams' : '/dashboard'} className="btn btn-primary btn-block">
                {loc.pathname.startsWith('/s/') ? 'Ke daftar ujian' : 'Ke Dashboard'}
              </Link>
              <div className="flex justify-center pt-1"><ThemeToggle /></div>
            </div>
          </div>
        }
      />
    </Routes>
  )
}
