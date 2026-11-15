import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getAccessToken } from '@flowcbt/api-client';
import LoginPage from './features/auth/LoginPage';
import GuestPage from './features/auth/GuestPage';
import ExamsPage from './features/exams/ExamsPage';
import StartPage from './features/exams/StartPage';
import AttemptPage from './features/attempt/AttemptPage';
import ReviewPage from './features/attempt/ReviewPage';
import DonePage from './features/attempt/DonePage';
import HistoryPage from './features/history/HistoryPage';

function RequireAuth({ children }: { children: React.ReactElement }) {
  if (!getAccessToken()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/guest" element={<GuestPage />} />
      <Route path="/exams" element={<RequireAuth><ExamsPage /></RequireAuth>} />
      <Route path="/exams/:id/start" element={<RequireAuth><StartPage /></RequireAuth>} />
      <Route path="/attempt/:id" element={<RequireAuth><AttemptPage /></RequireAuth>} />
      <Route path="/attempt/:id/review" element={<RequireAuth><ReviewPage /></RequireAuth>} />
      <Route path="/attempt/:id/done" element={<RequireAuth><DonePage /></RequireAuth>} />
      <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/exams" replace />} />
    </Routes>
  );
}
