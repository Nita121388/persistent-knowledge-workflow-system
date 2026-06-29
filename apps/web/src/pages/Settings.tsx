import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { ArrowLeft, Plus, Trash2, Settings2, Database, Bot, BookText } from 'lucide-react';

type Tab = 'general' | 'ai' | 'vault' | 'rules';

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

  const tabs = [
    { key: 'general' as Tab, label: 'General', icon: Settings2 },
    { key: 'ai' as Tab, label: 'AI', icon: Bot },
    { key: 'vault' as Tab, label: 'Vault', icon: Database },
    { key: 'rules' as Tab, label: 'Rules', icon: BookText },
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
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'general' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="font-medium mb-3">General Settings</h2>
            {settings ? (
              <div className="space-y-3 text-sm">
                <div><span className="text-gray-500">Vault:</span> <span className="font-mono">{settings.vaultPath}</span></div>
                <div><span className="text-gray-500">Inbox:</span> <span className="font-mono">{settings.inboxPath}</span></div>
                <div><span className="text-gray-500">Workspace:</span> <span className="font-mono">{settings.workspacePath}</span></div>
                <div><span className="text-gray-500">Model:</span> <span>{settings.aiDefaultModel}</span></div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Auto-analyze:</span>
                  <span className={settings.autoAnalyze ? 'text-green-600' : 'text-gray-400'}>
                    {settings.autoAnalyze ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No settings configured. Run setup first.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="font-medium mb-3">AI Configuration</h2>
            {settings ? (
              <div className="space-y-3 text-sm">
                <div><span className="text-gray-500">Provider:</span> <span>{settings.aiProvider}</span></div>
                <div><span className="text-gray-500">Base URL:</span> <span className="font-mono">{settings.aiBaseUrl}</span></div>
                <div><span className="text-gray-500">Default Model:</span> <span>{settings.aiDefaultModel}</span></div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">API Key:</span>
                  <span className={settings.aiApiKeyConfigured ? 'text-green-600' : 'text-red-500'}>
                    {settings.aiApiKeyConfigured ? 'Configured' : 'Not set'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Configure AI in the setup wizard first.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'vault' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="font-medium mb-3">Vault Configuration</h2>
            {settings ? (
              <div className="space-y-3 text-sm">
                <div><span className="text-gray-500">Vault Path:</span> <span className="font-mono">{settings.vaultPath}</span></div>
                <div><span className="text-gray-500">Inbox Path:</span> <span className="font-mono">{settings.inboxPath}</span></div>
                <div><span className="text-gray-500">Workspace:</span> <span className="font-mono">{settings.workspacePath}</span></div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Configure vault in the setup wizard first.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="space-y-4">
          {/* Add new rule */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="font-medium mb-3">Add Workspace Rule</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Rule title"
                value={newRule.title}
                onChange={e => setNewRule({ ...newRule, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <textarea
                rows={3}
                placeholder="Rule content — this guides AI proposals"
                value={newRule.content}
                onChange={e => setNewRule({ ...newRule, content: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <button
                onClick={() => addRuleMutation.mutate()}
                disabled={!newRule.title || !newRule.content}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> Add Rule
              </button>
            </div>
          </div>

          {/* Rules list */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="font-medium mb-3">Workspace Rules ({rules.length})</h2>
            {rules.length === 0 && (
              <p className="text-sm text-gray-400">No rules yet. Add rules to guide AI proposals.</p>
            )}
            <div className="space-y-3">
              {(rules as any[]).map((rule: any) => (
                <div key={rule.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${rule.enabled ? 'bg-green-400' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{rule.title}</span>
                      <span className="text-xs text-gray-400">p{rule.priority}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${rule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {rule.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{rule.content}</p>
                  </div>
                  <button
                    onClick={() => deleteRuleMutation.mutate(rule.id)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
