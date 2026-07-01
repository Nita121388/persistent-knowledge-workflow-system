import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { Plus, Trash2, Pencil, Settings2, Database, Bot, BookText, FolderOpen, ExternalLink, CheckCircle2, Cpu } from 'lucide-react';
import { cn } from '../lib/utils.js';

type Tab = 'general' | 'ai' | 'vault' | 'rules' | 'agent-runtime';

function PathDisplay({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
      <div className="min-w-0 flex-1">
        <span className="text-xs text-gray-500 block mb-0.5">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-gray-800 truncate" title={path}>{path}</span>
          <button
            onClick={() => navigator.clipboard?.writeText(path)}
            className="text-gray-300 hover:text-gray-500 shrink-0"
            title="Copy path"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({ tab: initialTab }: { tab?: string }) {
  const [activeTab, setActiveTab] = useState<Tab>((initialTab as Tab) || 'general');
  const queryClient = useQueryClient();

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<any>('/settings'),
  });
  const settings = settingsData?.ok ? settingsData.data : null;

  const { data: rulesData } = useQuery({
    queryKey: ['workspace-rules'],
    queryFn: () => apiGet<any[]>('/workspace-rules'),
  });
  const rules = rulesData?.ok ? rulesData.data : [];

  const [newRule, setNewRule] = useState({ title: '', content: '', enabled: true, priority: 100 });

  const addRuleMutation = useMutation({
    mutationFn: () => apiPost('/workspace-rules', newRule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-rules'] });
      setNewRule({ title: '', content: '', enabled: true, priority: 100 });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => apiDelete(`/workspace-rules/${ruleId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-rules'] }),
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ ruleId, data }: { ruleId: string; data: Record<string, unknown> }) =>
      apiPut(`/workspace-rules/${ruleId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-rules'] });
      setEditingRule(null);
    },
  });

  const [editingRule, setEditingRule] = useState<{
    id: string; title: string; content: string; enabled: boolean; priority: number;
  } | null>(null);

  const tabs = [
    { key: 'general' as Tab, label: 'General', icon: Settings2 },
    { key: 'ai' as Tab, label: 'AI', icon: Bot },
    { key: 'vault' as Tab, label: 'Vault', icon: Database },
    { key: 'rules' as Tab, label: 'Rules', icon: BookText },
    { key: 'agent-runtime' as Tab, label: 'Agent', icon: Cpu },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 sm:flex-none',
              activeTab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'general' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold mb-4">System Status</h2>
            {settings ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-gray-700">System is configured and ready</span>
                </div>

                <div className="border-t border-gray-100 pt-4 mt-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Paths</h3>
                  <div className="space-y-2">
                    <PathDisplay label="Vault" path={settings.vaultPath} />
                    <PathDisplay label="Inbox" path={settings.inboxPath} />
                    <PathDisplay label="Workspace" path={settings.workspacePath} />
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">AI</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-gray-500">Model</span>
                      <span className="font-medium">{settings.aiDefaultModel}</span>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-gray-500">API Key</span>
                      <span className={settings.aiApiKeyConfigured ? 'text-green-600' : 'text-red-500'}>
                        {settings.aiApiKeyConfigured ? 'Configured' : 'Not set'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-gray-500">Auto-analyze</span>
                      <span className={settings.autoAnalyze ? 'text-green-600' : 'text-gray-400'}>
                        {settings.autoAnalyze ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">System not initialized yet.</p>
                <p className="text-xs text-gray-400 mt-1">Run the setup wizard to configure PKWS.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold mb-4">AI Configuration</h2>
            {settings ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <Database className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-500">Provider:</span>
                  <span className="font-medium">{settings.aiProvider}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <ExternalLink className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-500">Base URL:</span>
                  <span className="font-mono text-sm">{settings.aiBaseUrl}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Bot className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-500">Default Model:</span>
                  <span className="font-medium">{settings.aiDefaultModel}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className={cn('w-2 h-2 rounded-full', settings.aiApiKeyConfigured ? 'bg-green-400' : 'bg-red-400')} />
                  <span className="text-gray-500">API Key:</span>
                  <span className={settings.aiApiKeyConfigured ? 'text-green-600' : 'text-red-500'}>
                    {settings.aiApiKeyConfigured ? 'Configured' : 'Not set'}
                  </span>
                </div>
                {settings.aiMaxTokens && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">Max Tokens:</span>
                    <span className="font-medium">{settings.aiMaxTokens}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">Configure AI in the setup wizard first.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'vault' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold mb-4">Vault Configuration</h2>
            {settings ? (
              <div className="space-y-3">
                <PathDisplay label="Vault Root" path={settings.vaultPath} />
                <PathDisplay label="Inbox Directory" path={settings.inboxPath} />
                <PathDisplay label="Workspace" path={settings.workspacePath} />
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">Configure vault in the setup wizard first.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="space-y-4">
          {/* Add new rule */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold mb-4">Add Workspace Rule</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Rule title"
                value={newRule.title}
                onChange={e => setNewRule({ ...newRule, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
              />
              <textarea
                rows={3}
                placeholder="Rule content — this guides AI proposals"
                value={newRule.content}
                onChange={e => setNewRule({ ...newRule, content: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500 focus:border-pkws-500"
              />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={newRule.enabled}
                    onChange={e => setNewRule({ ...newRule, enabled: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  Enabled
                </label>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>Priority:</span>
                  <input
                    type="number"
                    value={newRule.priority}
                    onChange={e => setNewRule({ ...newRule, priority: parseInt(e.target.value) || 100 })}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                </div>
              </div>
              <button
                onClick={() => addRuleMutation.mutate()}
                disabled={!newRule.title || !newRule.content}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Rule
              </button>
            </div>
          </div>

          {/* Rules list */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold mb-4">Workspace Rules ({rules.length})</h2>
            {rules.length === 0 && (
              <div className="text-center py-8">
                <BookText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-400">No rules yet. Add rules to guide AI proposals.</p>
                <p className="text-xs text-gray-400 mt-1">Rules help the AI understand your preferences for organizing knowledge.</p>
              </div>
            )}
            <div className="space-y-3">
              {(rules as any[]).map((rule: any) => (
                <div key={rule.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg group hover:bg-gray-100 transition-colors">
                  <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', rule.enabled ? 'bg-green-400' : 'bg-gray-300')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{rule.title}</span>
                      <span className="text-xs text-gray-400">p{rule.priority}</span>
                      <span className={cn(
                        'text-xs px-1.5 py-0.5 rounded',
                        rule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      )}>
                        {rule.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{rule.content}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingRule({ id: rule.id, title: rule.title, content: rule.content, enabled: rule.enabled, priority: rule.priority })}
                      className="text-gray-300 hover:text-pkws-600 opacity-0 group-hover:opacity-100 transition-all"
                      title="Edit rule"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteRuleMutation.mutate(rule.id)}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Edit Rule Modal */}
          {editingRule && (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setEditingRule(null)}>
              <div className="bg-white rounded-xl p-8 w-full max-w-2xl mx-6 shadow-xl" onClick={e => e.stopPropagation()}>
                <h3 className="font-semibold text-lg mb-5">Edit Rule</h3>
                <div className="space-y-4">
                  <input type="text" placeholder="Rule title" value={editingRule.title}
                    onChange={e => setEditingRule({ ...editingRule, title: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-pkws-500" />
                  <textarea rows={8} placeholder="Rule content" value={editingRule.content}
                    onChange={e => setEditingRule({ ...editingRule, content: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pkws-500" />
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" checked={editingRule.enabled}
                        onChange={e => setEditingRule({ ...editingRule, enabled: e.target.checked })}
                        className="rounded border-gray-300" />
                      Enabled
                    </label>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>Priority:</span>
                      <input type="number" value={editingRule.priority}
                        onChange={e => setEditingRule({ ...editingRule, priority: parseInt(e.target.value) || 100 })}
                        className="w-24 px-3 py-2 border border-gray-300 rounded text-sm" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <button onClick={() => setEditingRule(null)}
                      className="px-5 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
                    <button onClick={() => updateRuleMutation.mutate({ ruleId: editingRule.id, data: { title: editingRule.title, content: editingRule.content, enabled: editingRule.enabled, priority: editingRule.priority } })}
                      disabled={!editingRule.title || !editingRule.content}
                      className="px-5 py-2.5 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-40">Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agent Runtime Tab */}
      {activeTab === 'agent-runtime' && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold mb-4">Agent Runtime</h2>
            {settings ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <div className={cn('w-2 h-2 rounded-full', settings.agentRuntimeEnabled ? 'bg-green-400' : 'bg-gray-300')} />
                  <span className="text-gray-500">Status:</span>
                  <span className={cn('font-medium', settings.agentRuntimeEnabled ? 'text-green-700' : 'text-gray-500')}>
                    {settings.agentRuntimeEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Cpu className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-500">CLI:</span>
                  <span className="font-mono text-sm">{settings.agentCliPath || '(auto-detect)'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Max Active Sessions:</span>
                  <span className="font-medium">{settings.maxActiveSessions}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Session Timeout:</span>
                  <span className="font-medium">{settings.sessionTimeoutMinutes} min</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Sandbox Mode:</span>
                  <span className="font-medium">{settings.sandboxMode}</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">Configure system in the setup wizard first.</p>
              </div>
            )}
          </div>

          {/* Configuration Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold mb-4">Context Management</h2>
            {settings ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500">Compress Threshold</span>
                  <span className="font-medium">{settings.contextCompressThreshold} messages</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500">Keep Recent</span>
                  <span className="font-medium">{settings.contextKeepRecentCount} messages</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500">Max Tokens per Session</span>
                  <span className="font-medium">{settings.maxTokensPerSession.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">Configure system first.</p>
              </div>
            )}
          </div>

          {/* Info note */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <p className="font-medium mb-1">About Agent Runtime</p>
            <p className="text-amber-700">
              Agent Runtime enables PKWS to maintain in-memory context across multiple AI interactions,
              use local CLI agents (Codex / Claude Code) for multi-step reasoning, and automatically
              schedule work across active Cases.
            </p>
            <p className="text-amber-700 mt-2">
              When enabled, AI proposals will be generated via the configured CLI agent instead of
              the direct LLM API call. The scheduler processes Cases with new user input first.
            </p>
            <p className="text-amber-700 mt-2">
              CLI paths are auto-detected. Install{' '}
              <a href="https://github.com/openai/codex" className="underline" target="_blank" rel="noopener noreferrer">Codex CLI</a>{' '}
              or{' '}
              <a href="https://docs.anthropic.com/en/docs/claude-code/overview" className="underline" target="_blank" rel="noopener noreferrer">Claude Code</a>{' '}
              to use this feature.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
