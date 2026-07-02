import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './lib/api.js';
import { SetupWizard } from './pages/SetupWizard.js';
import { Dashboard } from './pages/Dashboard.js';
import { CaseDetailPage } from './pages/CaseDetail.js';
import { ProposalReviewPage } from './pages/ProposalReview.js';
import { PatchPreviewPage } from './pages/PatchPreview.js';
import { SettingsPage } from './pages/Settings.js';
import { AgentRuntimeDashboardPage } from './pages/AgentRuntimeDashboard.js';
import { LogsPage } from './pages/Logs.js';
import { Layout } from './components/Layout.js';
import { LoadingScreen } from './components/LoadingScreen.js';

export default function App() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet('/settings'),
    retry: 1,
  });

  if (isLoading) return <LoadingScreen />;

  // If no settings found, show setup wizard
  if (isError || !data?.ok) {
    return <SetupWizard />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        <Route path="/cases/:caseId/proposal" element={<ProposalReviewPage />} />
        <Route path="/cases/:caseId/patch" element={<PatchPreviewPage />} />
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
