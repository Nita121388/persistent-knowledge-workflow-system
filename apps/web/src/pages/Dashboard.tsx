import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../lib/api.js';
import { cn, timeAgo, getStatusColor } from '../lib/utils.js';
import type { CaseListItem } from '@pkws/shared';
import { Inbox, AlertCircle, CheckCircle2, Archive, Clock, RefreshCw } from 'lucide-react';

const QUEUES = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, desc: 'New captures' },
  { key: 'review', label: 'Review', icon: AlertCircle, desc: 'Awaiting decision' },
  { key: 'active', label: 'Active', icon: Clock, desc: 'In progress' },
  { key: 'closed', label: 'Closed', icon: Archive, desc: 'Done / Dropped' },
] as const;

export function Dashboard() {
  const [activeQueue, setActiveQueue] = useState<string>('review');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['cases', activeQueue],
    queryFn: () => apiGet<CaseListItem[]>(`/cases?queue=${activeQueue}&limit=50`),
    refetchInterval: 10_000,
  });

  const scanMutation = useMutation({
    mutationFn: () => apiPost('/inbox/scan', { mode: 'incremental' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  const cases = data?.ok ? data.data : [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Knowledge Tasks</h1>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', scanMutation.isPending && 'animate-spin')} />
          Scan Inbox
        </button>
      </div>

      {/* Queue tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {QUEUES.map(({ key, label, icon: Icon, desc }) => (
          <button
            key={key}
            onClick={() => setActiveQueue(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1',
              activeQueue === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
            <span className="text-xs text-gray-400">{desc}</span>
          </button>
        ))}
      </div>

      {/* Case list */}
      <div className="space-y-2">
        {isLoading && (
          <div className="text-center py-12 text-gray-400">
            <Clock className="w-8 h-8 mx-auto mb-2 animate-pulse" />
            Loading...
          </div>
        )}

        {!isLoading && cases.length === 0 && (
          <div className="text-center py-12">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No cases in {activeQueue}</p>
            {activeQueue === 'inbox' && (
              <p className="text-sm text-gray-400 mt-1">
                Use Obsidian Web Clipper to capture content first
              </p>
            )}
          </div>
        )}

        {cases.map((c: any) => (
          <Link
            key={c.id}
            to={`/cases/${c.id}`}
            className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-pkws-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-gray-900 truncate">{c.title}</h3>
                {c.currentVaultPath && (
                  <p className="text-xs text-gray-400 mt-1 truncate">{c.currentVaultPath}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', getStatusColor(c.status))}>
                  {c.status}
                </span>
                <span className="text-xs text-gray-400">{timeAgo(c.updatedAt)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
