import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { MfaGatePage } from './pages/MfaGatePage';
import { DashboardPage } from './pages/DashboardPage';
import { SystemsPage } from './pages/SystemsPage';
import { SystemDetailPage } from './pages/SystemDetailPage';
import { AssessmentsListPage } from './pages/AssessmentsListPage';
import { AssessmentWizardPage } from './pages/AssessmentWizardPage';
import { ActionsPage } from './pages/ActionsPage';
import { AuditorWorkspacePage } from './pages/AuditorWorkspacePage';
import { AdminPage } from './pages/AdminPage';
import { SecurityProfilePage } from './pages/SecurityProfilePage';
import { UserManualPage } from './pages/UserManualPage';

const queryClient = new QueryClient();

function ProtectedRoute({
  children,
  roles
}: {
  children: React.ReactNode;
  roles?: Array<'admin' | 'user' | 'auditor'>;
}) {
  const { session, isLoading } = useAuth();
  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm">Loading...</div>;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (session.mfaMandatory && (!session.hasMfaEnrolled || !session.mfaVerified)) {
    return <Navigate to="/mfa" replace />;
  }
  if (roles && !roles.includes(session.user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Layout>{children}</Layout>;
}

function MfaRoute() {
  const { session, isLoading } = useAuth();
  if (isLoading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (session.mfaVerified && session.hasMfaEnrolled) return <Navigate to="/" replace />;
  return <MfaGatePage />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ForgotPasswordPage />} />
            <Route path="/mfa" element={<MfaRoute />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/systems"
              element={
                <ProtectedRoute>
                  <SystemsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/systems/:id"
              element={
                <ProtectedRoute>
                  <SystemDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/assessments"
              element={
                <ProtectedRoute>
                  <AssessmentsListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/assessments/:id"
              element={
                <ProtectedRoute>
                  <AssessmentWizardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/actions"
              element={
                <ProtectedRoute>
                  <ActionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/auditor"
              element={
                <ProtectedRoute roles={['auditor', 'admin']}>
                  <AuditorWorkspacePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/security"
              element={
                <ProtectedRoute>
                  <SecurityProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/manual"
              element={
                <ProtectedRoute>
                  <UserManualPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
