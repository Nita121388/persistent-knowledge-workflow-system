import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, apiPost } from '../lib/api.js';
import { FolderOpen, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils.js';

interface PathInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Expected to exist (vault, inbox) */
  expectExists?: boolean;
  /** Expected to NOT exist (workspace — will be created) */
  expectCreatable?: boolean;
}

function PathInput({ label, value, onChange, placeholder, expectExists, expectCreatable }: PathInputProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500 transition-colors"
        />
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {label.includes('Vault') && 'Your Obsidian vault root directory'}
        {label.includes('Inbox') && 'Where Obsidian Web Clipper saves notes (must be inside vault)'}
        {label.includes('Workspace') && 'Where PKWS stores its data (must be outside vault)'}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">
        PKWS reads files directly from your local disk — no upload needed.
      </p>
    </div>
  );
}

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
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const canProceedStep1 = vaultPath.trim() && inboxPath.trim() && workspacePath.trim();
  const canProceedStep2 = aiBaseUrl.trim() && aiApiKey.trim() && aiDefaultModel.trim();

  const handleTestModel = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiPost('/settings/test-model', {
        aiProvider, aiBaseUrl, aiApiKey, aiDefaultModel,
      });
      if (result.ok) {
        setTestResult(`✅ Connected! Latency: ${result.data.latencyMs}ms`);
      } else {
        setTestResult(`❌ ${result.error.message}`);
      }
    } catch (err: any) {
      setTestResult(`❌ ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await apiPut('/settings', {
        vaultPath, inboxPath, workspacePath,
        aiProvider, aiBaseUrl, aiApiKey, aiDefaultModel,
        autoAnalyze: true,
        // Default to the agent runtime as the execution path; user can turn it
        // off later in Settings → Agent Runtime. Layout topbar reflects state.
        agentRuntimeEnabled: true,
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50 p-4">
      <div className="w-full max-w-xl">
        {/* Logo + Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-pkws-600 rounded-2xl mb-4 shadow-lg shadow-pkws-200">
            <span className="text-white text-2xl font-bold">K</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">PKWS Setup</h1>
          <p className="text-gray-500 mt-1">Persistent Knowledge Workflow System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          {/* Step indicator */}
          <div className="flex items-center gap-3 mb-8">
            {[{ n: 1, label: 'Paths' }, { n: 2, label: 'AI' }, { n: 3, label: 'Review' }].map(({ n, label }) => (
              <div key={n} className="flex items-center gap-3 flex-1">
                <div className={cn(
                  'flex items-center gap-2',
                  n <= step ? 'text-pkws-600' : 'text-gray-300'
                )}>
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all',
                    n < step ? 'bg-pkws-100 text-pkws-600 border-2 border-pkws-300' :
                    n === step ? 'bg-pkws-600 text-white shadow-md shadow-pkws-200' :
                    'bg-gray-50 text-gray-400 border-2 border-gray-200'
                  )}>
                    {n < step ? '✓' : n}
                  </div>
                  <span className={cn(
                    'text-sm font-medium hidden sm:inline',
                    n === step ? 'text-gray-900' : 'text-gray-400'
                  )}>{label}</span>
                </div>
                {n < 3 && <div className={cn('flex-1 h-0.5 rounded', n < step ? 'bg-pkws-300' : 'bg-gray-200')} />}
              </div>
            ))}
          </div>

          {/* Step 1: Vault Configuration */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Configure Paths</h2>
                <p className="text-sm text-gray-500 mt-1">Set up your Obsidian vault and workspace locations</p>
              </div>

              <PathInput
                label="Obsidian Vault Path"
                value={vaultPath}
                onChange={setVaultPath}
                placeholder="/path/to/obsidian/vault"
                expectExists
              />

              <PathInput
                label="Clipper Inbox Path"
                value={inboxPath}
                onChange={setInboxPath}
                placeholder="/path/to/vault/inbox"
                expectExists
              />

              <PathInput
                label="Workspace Path"
                value={workspacePath}
                onChange={setWorkspacePath}
                placeholder="/path/to/pkws-workspace"
                expectCreatable
              />
            </div>
          )}

          {/* Step 2: AI Configuration */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">AI Configuration</h2>
                <p className="text-sm text-gray-500 mt-1">Connect an AI provider for automatic analysis</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Provider</label>
                <div className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  OpenAI-compatible (MVP)
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Base URL</label>
                <input
                  type="text"
                  value={aiBaseUrl}
                  onChange={e => setAiBaseUrl(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">API Key</label>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={e => setAiApiKey(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500 transition-colors"
                  placeholder="sk-..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Default Model</label>
                <input
                  type="text"
                  value={aiDefaultModel}
                  onChange={e => setAiDefaultModel(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500 transition-colors"
                />
              </div>

              {/* Test result */}
              {testResult && (
                <div className={cn(
                  'px-4 py-3 rounded-lg text-sm',
                  testResult.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' :
                  'bg-red-50 text-red-700 border border-red-200'
                )}>
                  {testResult}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Review & Save */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Review & Save</h2>
                <p className="text-sm text-gray-500 mt-1">Confirm your configuration before starting</p>
              </div>

              <div className="bg-gray-50 rounded-xl p-5 space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Vault</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Vault</span>
                      <span className="font-mono text-xs font-medium text-gray-900 ml-4 text-right break-all">{vaultPath}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Inbox</span>
                      <span className="font-mono text-xs font-medium text-gray-900 ml-4 text-right break-all">{inboxPath}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Workspace</span>
                      <span className="font-mono text-xs font-medium text-gray-900 ml-4 text-right break-all">{workspacePath}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">AI</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Model</span>
                      <span className="font-medium text-gray-900">{aiDefaultModel}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">API Key</span>
                      <span className={aiApiKey ? 'text-green-600' : 'text-red-500'}>
                        {aiApiKey ? '••••••••' : 'Not set'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
              >
                ← Back
              </button>
            ) : <div />}

            {step < 3 ? (
              <button
                onClick={() => {
                  if (step === 2) {
                    handleTestModel();
                  }
                  setStep(step + 1);
                }}
                disabled={step === 1 ? !canProceedStep1 : step === 2 ? !canProceedStep2 : false}
                className="px-6 py-2.5 text-sm font-medium bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-pkws-200"
              >
                {step === 2 ? (testing ? 'Testing...' : 'Test & Continue →') : 'Continue →'}
              </button>
            ) : (
              <button
                onClick={saveSettings}
                disabled={saving}
                className="px-6 py-2.5 text-sm font-medium bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-40 transition-colors shadow-sm shadow-pkws-200"
              >
                {saving ? 'Saving...' : 'Save & Start →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
