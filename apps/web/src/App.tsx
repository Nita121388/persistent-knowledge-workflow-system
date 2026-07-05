import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './lib/api.js';
import { SetupWizard } from './pages/SetupWizard.js';
import { Dashboard } from './pages/Dashboard.js';
import { CaseDetailPage } from './pages/CaseDetail.js';
import { ProposalReviewPage } from './pages/ProposalReview.js';
import { SettingsPage } from './pages/Settings.js';
import { AgentRuntimeDashboardPage } from './pages/AgentRuntimeDashboard.js';
import { LogsPage } from './pages/Logs.js';
import { Layout } from './components/Layout.js';
import { LoadingScreen } from './components/LoadingScreen.js';

export default function App() {
  const { data, isLoading, isError, failureCount } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet('/settings'),
    retry: 3,
    retryDelay: 1000,
  });

  if (isLoading) return <LoadingScreen />;

  // Only show setup wizard if settings definitively don't exist (NOT_INITIALIZED or NOT_FOUND)
  const errorCode = (!data?.ok && data?.error?.code) ? data.error.code : null;
  const shouldShowSetup = (isError || errorCode === 'NOT_INITIALIZED' || errorCode === 'NOT_FOUND') && failureCount >= 3;

  if (shouldShowSetup) {
    return <SetupWizard />;
  }

  // If settings API fails but we haven't exhausted retries, show a friendly message
  if (isError || !data?.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-4 border-4 border-pkws-300 border-t-pkws-600 rounded-full animate-spin" />
          <p className="text-gray-500">Connecting to server...</p>
          <p className="text-xs text-gray-400 mt-1">Make sure the backend server is running</p>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        <Route path="/cases/:caseId/proposal" element={<ProposalReviewPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/agent-runtime" element={<AgentRuntimeDashboardPage />} />
        <Route path="/settings/ai" element={<SettingsPage tab="ai" />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings/vault" element={<SettingsPage tab="vault" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
