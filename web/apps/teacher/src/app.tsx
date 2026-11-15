import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getAccessToken } from '@flowcbt/api-client';
import Layout from './layout';
import LoginPage from './features/auth/LoginPage';
import RegisterPage from './features/auth/RegisterPage';
import DashboardPage from './features/dashboard/DashboardPage';
import ClassesPage from './features/classes/ClassesPage';
import StudentsPage from './features/students/StudentsPage';
import StudentDetailPage from './features/students/StudentDetailPage';
import QuestionSetsPage from './features/question-sets/QuestionSetsPage';
import QuestionSetEditorPage from './features/question-sets/QuestionSetEditorPage';
import ExamsPage from './features/exams/ExamsPage';
import ExamWizardPage from './features/exams/ExamWizardPage';
import ExamDetailPage from './features/exams/ExamDetailPage';
import LiveReportPage from './features/reports/LiveReportPage';
import HistoryReportPage from './features/reports/HistoryReportPage';
import ExamReportPage from './features/reports/ExamReportPage';
import GradingPage from './features/grading/GradingPage';
import CheatingPage from './features/exams/CheatingPage';
import BillingPage from './features/billing/BillingPage';
import SettingsPage from './features/settings/SettingsPage';
import AdminPage from './features/admin/AdminPage';

function RequireAuth({ children }: { children: React.ReactElement }) {
  if (!getAccessToken()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/classes" element={<ClassesPage />} />
        <Route path="/students" element={<StudentsPage />} />
        <Route path="/students/:id" element={<StudentDetailPage />} />
        <Route path="/question-sets" element={<QuestionSetsPage />} />
        <Route path="/question-sets/:id/edit" element={<QuestionSetEditorPage />} />
        <Route path="/exams" element={<ExamsPage />} />
        <Route path="/exams/new" element={<ExamWizardPage />} />
        <Route path="/exams/:id" element={<ExamDetailPage />} />
        <Route path="/exams/:id/cheating" element={<CheatingPage />} />
        <Route path="/reports/live" element={<LiveReportPage />} />
        <Route path="/reports/history" element={<HistoryReportPage />} />
        <Route path="/reports/exams/:id" element={<ExamReportPage />} />
        <Route path="/grading/:attemptId" element={<GradingPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
