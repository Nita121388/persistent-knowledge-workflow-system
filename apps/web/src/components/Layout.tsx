import { Link, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { LayoutDashboard, Settings2, Cpu, ScrollText, Play, Square, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/agent-runtime', label: 'Agents', icon: Cpu },
  { path: '/logs', label: 'Logs', icon: ScrollText },
  { path: '/settings', label: 'Settings', icon: Settings2 },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiGet<any>('/settings'),
    refetchInterval: 10000,
  });
  const isAgentEnabled = settingsData?.ok ? !!settingsData.data?.agentRuntimeEnabled : false;

  const toggleMutation = useMutation({
    mutationFn: () => apiPost('/agent-runtime/toggle'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['agent-runtime-status'] });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-6 h-6 bg-pkws-600 rounded flex items-center justify-center">
                <span className="text-white text-xs font-bold">K</span>
              </div>
              <span className="font-semibold text-sm hidden sm:inline">PKWS</span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
                <Link
                  key={path}
                  to={path}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                    location.pathname === path || (path === '/settings' && location.pathname.startsWith('/settings')) || (path === '/agent-runtime' && location.pathname.startsWith('/agent-runtime')) || (path === '/logs' && location.pathname.startsWith('/logs'))
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-500 hover:text-gray-700'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors border',
                isAgentEnabled
                  ? 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border-gray-200'
              )}
              title={isAgentEnabled ? 'Disable Agent Runtime' : 'Enable Agent Runtime'}
            >
              {toggleMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isAgentEnabled ? (
                <Play className="w-3 h-3 fill-green-600" />
              ) : (
                <Square className="w-3 h-3" />
              )}
              <span className="hidden sm:inline">{isAgentEnabled ? 'Agent ON' : 'Agent OFF'}</span>
            </button>
            <span className="text-xs text-gray-400">v0.1.0</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main>{children}</main>
    </div>
  );
}
