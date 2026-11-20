// Router area guru/admin — dipasang di sini sesuai sitemap PRD §11.1
import { Link, Navigate, Route, Routes } from 'react-router-dom'
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
import ReportsLive from './guru/reports/live'
import ReportLiveExam from './guru/reports/live-detail'
import ReportsHistory from './guru/reports/history'
import ReportExam from './guru/reports/exam'
import Billing from './guru/billing'
import Settings from './guru/settings'
import SiswaRoutes from './siswa/SiswaRoutes'

// Halaman fondasi — sistem fitur dipasang bertahap
export default function App() {
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
          <div className="min-h-full flex items-center justify-center p-6">
            <div className="card max-w-sm w-full text-center space-y-3">
              <div className="text-2xl font-bold text-primary">FlowCBT</div>
              <div className="text-muted">404 — Halaman tidak ditemukan</div>
              {location.pathname.startsWith('/s/') ? (
                <Link to="/s/exams" className="btn-primary w-full">Ke daftar ujian</Link>
              ) : (
                <Link to="/dashboard" className="btn-primary w-full">Ke Dashboard</Link>
              )}
              <div className="flex justify-center"><ThemeToggle /></div>
            </div>
          </div>
        }
      />
    </Routes>
  )
}
