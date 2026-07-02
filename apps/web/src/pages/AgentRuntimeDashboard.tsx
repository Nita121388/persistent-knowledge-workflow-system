import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import { cn, timeAgo } from '../lib/utils.js';
import { Cpu, Play, Square, RefreshCw, Clock, MessageSquare, AlertCircle, CheckCircle2, Loader2, ArrowLeft, Trash2, XCircle, RotateCcw, Shield } from 'lucide-react';

interface SessionSummary {
  caseId: string;
  turnCount: number;
  totalTokens: number;
  awaitingUserInput: boolean;
  hasNewUserInput: boolean;
  lastActiveAt: string;
  compressionEpoch: number;
  messageCount: number;
  recentMessages: Array<{ role: string; content: string; timestamp: string }>;
}

interface WsEvent {
  type: string;
  caseId?: string;
  action?: string;
  durationMs?: number;
  error?: string;
  pending?: number;
  waiting?: number;
  running?: boolean;
}

type Tab = 'overview' | 'sessions';

export function AgentRuntimeDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [wsConnected, setWsConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState<WsEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch status + sessions
  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['agent-runtime-status'],
    queryFn: () => apiGet<any>('/agent-runtime/status'),
    refetchInterval: 5000,
  });

  const { data: sessionsData, refetch: refetchSessions } = useQuery({
    queryKey: ['agent-runtime-sessions'],
    queryFn: () => apiGet<any>('/agent-runtime/sessions'),
    refetchInterval: 5000,
  });

  const status = statusData?.ok ? statusData.data : null;
  const sessions = sessionsData?.ok ? (sessionsData.data as { sessions: SessionSummary[] })?.sessions ?? [] : [];

  // Mutations for session actions
  const clearSessionsMutation = useMutation({
    mutationFn: () => apiPost('/agent-runtime/clear-sessions'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-runtime-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-runtime-status'] });
    },
  });

  const retryCaseMutation = useMutation({
    mutationFn: (caseId: string) => apiPost(`/agent-runtime/${caseId}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-runtime-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-runtime-status'] });
    },
  });

  const stopCaseMutation = useMutation({
    mutationFn: (caseId: string) => apiPost(`/agent-runtime/${caseId}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-runtime-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-runtime-status'] });
    },
  });

  // WebSocket connection
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/api/agent-runtime/ws`;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const event: WsEvent = JSON.parse(e.data);
          if (event.type === 'connected') return;

          setLiveEvents(prev => {
            const next = [...prev, event];
            // Keep max 100 events
            return next.length > 100 ? next.slice(-100) : next;
          });
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Auto-reconnect after 3s
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  // Auto-scroll events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveEvents]);

  const clearEvents = useCallback(() => {
    setLiveEvents([]);
  }, []);

  const runtimeRunning = status?.running ?? false;

  const eventIcon = (event: WsEvent) => {
    switch (event.type) {
      case 'turn_started': return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      case 'turn_completed': return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case 'turn_failed': return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'session_created': return <Cpu className="w-3.5 h-3.5 text-purple-500" />;
      case 'session_evicted': return <Square className="w-3.5 h-3.5 text-gray-400" />;
      case 'queue_update': return <RefreshCw className="w-3.5 h-3.5 text-amber-500" />;
      default: return <Clock className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  const eventLabel = (event: WsEvent) => {
    switch (event.type) {
      case 'turn_started': return `Turn started: ${event.caseId} (${event.action})`;
      case 'turn_completed': return `Turn completed: ${event.caseId} (${event.durationMs}ms)`;
      case 'turn_failed': return `Turn failed: ${event.caseId} — ${event.error}`;
      case 'session_created': return `Session created: ${event.caseId}`;
      case 'session_evicted': return `Session evicted: ${event.caseId}`;
      case 'queue_update': return `Queue: ${event.pending} pending, ${event.waiting} waiting`;
      default: return JSON.stringify(event);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Agent Runtime Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* WS Connection status */}
          <div className="flex items-center gap-1.5 text-xs">
            <div className={cn('w-2 h-2 rounded-full', wsConnected ? 'bg-green-400' : 'bg-red-400')} />
            <span className="text-gray-500">{wsConnected ? 'Live' : 'Disconnected'}</span>
          </div>
          {/* Runtime status */}
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
            runtimeRunning ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
          )}>
            {runtimeRunning ? <Play className="w-3 h-3" /> : <Square className="w-3 h-3" />}
            {runtimeRunning ? 'Running' : 'Stopped'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 sm:flex-none',
            activeTab === 'overview' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <Cpu className="w-4 h-4" />
          Overview
        </button>
        <button
          onClick={() => setActiveTab('sessions')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 sm:flex-none',
            activeTab === 'sessions' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <MessageSquare className="w-4 h-4" />
          Sessions ({sessions.length})
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Status Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <Cpu className="w-4 h-4" />
                Status
              </div>
              <div className={cn(
                'text-lg font-semibold',
                runtimeRunning ? 'text-green-600' : 'text-gray-400',
              )}>
                {runtimeRunning ? 'Running' : 'Stopped'}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <Play className="w-4 h-4" />
                Active Sessions
              </div>
              <div className="text-lg font-semibold">{status?.activeSessions ?? 0}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <Clock className="w-4 h-4" />
                Pending
              </div>
              <div className="text-lg font-semibold text-amber-600">{status?.queueStats?.pending ?? 0}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <MessageSquare className="w-4 h-4" />
                Waiting (User)
              </div>
              <div className="text-lg font-semibold text-blue-600">{status?.queueStats?.waiting ?? 0}</div>
            </div>
          </div>

          {/* Live Events */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold">Live Events</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    clearSessionsMutation.mutate();
                  }}
                  disabled={clearSessionsMutation.isPending || sessions.length === 0}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-40"
                  title="Clear all sessions"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All Sessions
                </button>
                <button
                  onClick={clearEvents}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Clear Events
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-4 space-y-1">
              {liveEvents.length === 0 && (
                <div className="text-center py-8 text-sm text-gray-400">
                  No events yet. Events will appear here as the Agent Runtime processes Cases.
                </div>
              )}
              {liveEvents.map((event, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 text-sm">
                  <span className="shrink-0">{eventIcon(event)}</span>
                  <span className="text-gray-700 truncate flex-1">{eventLabel(event)}</span>
                </div>
              ))}
              <div ref={eventsEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Sessions Tab */}
      {activeTab === 'sessions' && (
        <div className="space-y-4">
          {sessions.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Cpu className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-400">No active sessions.</p>
              <p className="text-xs text-gray-400 mt-1">Sessions appear when the Agent Runtime processes Cases.</p>
            </div>
          )}

          {sessions.map((session: SessionSummary) => (
            <div key={session.caseId} className="bg-white rounded-xl border border-gray-200 p-6">
              {/* Session header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono text-sm font-medium">{session.caseId}</h3>
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      session.awaitingUserInput
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-green-100 text-green-700',
                    )}>
                      {session.awaitingUserInput ? 'Awaiting Input' : 'Processing'}
                    </span>
                    {session.hasNewUserInput && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                        New Input
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {session.awaitingUserInput && (
                    <button
                      onClick={() => retryCaseMutation.mutate(session.caseId)}
                      disabled={retryCaseMutation.isPending}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-pkws-600 hover:bg-pkws-50 rounded transition-colors disabled:opacity-40"
                      title="Retry this case"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => stopCaseMutation.mutate(session.caseId)}
                    disabled={stopCaseMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
                    title="Stop this case"
                  >
                    <XCircle className="w-3 h-3" />
                    Stop
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold">{session.turnCount}</div>
                  <div className="text-xs text-gray-500">Turns</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold">{session.messageCount}</div>
                  <div className="text-xs text-gray-500">Messages</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold">{(session.totalTokens / 1000).toFixed(1)}k</div>
                  <div className="text-xs text-gray-500">Tokens</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold">{session.compressionEpoch}</div>
                  <div className="text-xs text-gray-500">Compressions</div>
                </div>
              </div>

              {/* Recent Messages */}
              {session.recentMessages.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Recent Messages ({session.recentMessages.length})
                  </h4>
                  <div className="space-y-2">
                    {session.recentMessages.map((msg, i) => (
                      <div key={i} className={cn(
                        'p-3 rounded-lg text-sm',
                        msg.role === 'user' ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50 border border-gray-100',
                      )}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn(
                            'text-xs font-medium px-1.5 py-0.5 rounded',
                            msg.role === 'user'
                              ? 'bg-blue-200 text-blue-800'
                              : 'bg-gray-200 text-gray-700',
                          )}>
                            {msg.role}
                          </span>
                          <span className="text-xs text-gray-400">
                            {timeAgo(msg.timestamp)}
                          </span>
                        </div>
                        <p className="text-gray-700 whitespace-pre-wrap text-xs leading-relaxed">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Link back to settings */}
      <div className="mt-8 pt-6 border-t border-gray-200 flex items-center justify-between">
        <a
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-pkws-600 hover:text-pkws-700 underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Settings
        </a>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> {status?.sandboxMode ?? 'workspace-only'}</span>
          <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> {status?.cliPath || 'auto-detect'}</span>
        </div>
      </div>
    </div>
  );
}
