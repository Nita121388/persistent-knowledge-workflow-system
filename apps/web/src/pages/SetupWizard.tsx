import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, apiPost } from '../lib/api.js';

export function SetupWizard() {
  const [step, setStep] = useState(1);
  const [vaultPath, setVaultPath] = useState('');
  const [inboxPath, setInboxPath] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [aiProvider, setAiProvider] = useState('openai-compatible');
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.openai.com/v1');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiDefaultModel, setAiDefaultModel] = useState('gpt-4.1-mini');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const queryClient = useQueryClient();

  const testModelMutation = useMutation({
    mutationFn: () => apiPost('/settings/test-model', {
      aiProvider, aiBaseUrl, aiApiKey, aiDefaultModel,
    }),
  });

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await apiPut('/settings', {
        vaultPath, inboxPath, workspacePath,
        aiProvider, aiBaseUrl, aiApiKey, aiDefaultModel,
        autoAnalyze: true,
      });
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        setDone(true);
      } else {
        setError(result.error.message);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (done) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">PKWS Setup</h1>
          <p className="text-gray-500 mt-1">Persistent Knowledge Workflow System</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  s <= step ? 'bg-pkws-600 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                  {s}
                </div>
                {s < 3 && <div className={`w-8 h-0.5 ${s < step ? 'bg-pkws-600' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Vault Configuration</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Obsidian Vault Path</label>
                <input
                  type="text"
                  value={vaultPath}
                  onChange={e => setVaultPath(e.target.value)}
                  placeholder="E:/File/NitaFile/Obsidians/Obsidian"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Clipper Inbox Path</label>
                <input
                  type="text"
                  value={inboxPath}
                  onChange={e => setInboxPath(e.target.value)}
                  placeholder="E:/File/NitaFile/Obsidians/Obsidian/Inbox/Web Clips"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Workspace Path</label>
                <input
                  type="text"
                  value={workspacePath}
                  onChange={e => setWorkspacePath(e.target.value)}
                  placeholder="E:/code/pkws-workspace"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">AI Configuration</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                <input
                  type="text"
                  value={aiProvider}
                  disabled
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                />
                <p className="text-xs text-gray-400 mt-1">Only OpenAI-compatible in MVP</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="text"
                  value={aiBaseUrl}
                  onChange={e => setAiBaseUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={e => setAiApiKey(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Model</label>
                <input
                  type="text"
                  value={aiDefaultModel}
                  onChange={e => setAiDefaultModel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
                />
              </div>

              {testModelMutation.data && !testModelMutation.data.ok && (
                <p className="text-sm text-red-600">{testModelMutation.data.error.message}</p>
              )}
              {testModelMutation.data?.ok && (
                <p className="text-sm text-green-600">
                  Connected! Latency: {testModelMutation.data.data.latencyMs}ms
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Review & Save</h2>
              <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
                <div><span className="text-gray-500">Vault:</span> <span className="font-medium">{vaultPath}</span></div>
                <div><span className="text-gray-500">Inbox:</span> <span className="font-medium">{inboxPath}</span></div>
                <div><span className="text-gray-500">Workspace:</span> <span className="font-medium">{workspacePath}</span></div>
                <div><span className="text-gray-500">Model:</span> <span className="font-medium">{aiDefaultModel}</span></div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Back
              </button>
            ) : <div />}

            {step < 3 ? (
              <button
                onClick={() => {
                  if (step === 2) {
                    testModelMutation.mutate();
                  }
                  setStep(step + 1);
                }}
                className="px-4 py-2 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700"
              >
                {step === 2 ? 'Test & Continue' : 'Continue'}
              </button>
            ) : (
              <button
                onClick={saveSettings}
                disabled={saving}
                className="px-4 py-2 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save & Start'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
