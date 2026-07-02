import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { ScrollText, AlertCircle, Info, AlertTriangle, Bug, Search, X, RefreshCw } from 'lucide-react';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogCategory = 'system' | 'api' | 'agent' | 'worker' | 'ai' | 'db' | 'ws' | 'user';

interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  dataJson?: string;
  caseId?: string;
  jobId?: string;
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LOG_CATEGORIES: LogCategory[] = ['system', 'api', 'agent', 'worker', 'ai', 'db', 'ws', 'user'];

const LEVEL_ICONS: Record<LogLevel, React.ReactNode> = {
  debug: <Bug className="w-3 h-3" />,
  info: <Info className="w-3 h-3" />,
  warn: <AlertTriangle className="w-3 h-3" />,
  error: <AlertCircle className="w-3 h-3" />,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-gray-500',
  info: 'text-cyan-600',
  warn: 'text-amber-600',
  error: 'text-red-600',
};

const LEVEL_BG: Record<LogLevel, string> = {
  debug: 'bg-gray-100 text-gray-600',
  info: 'bg-cyan-100 text-cyan-700',
  warn: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
};

const CATEGORY_COLORS: Record<LogCategory, string> = {
  system: 'bg-gray-700 text-gray-100',
  api: 'bg-blue-600 text-white',
  agent: 'bg-purple-600 text-white',
  worker: 'bg-amber-600 text-white',
  ai: 'bg-green-600 text-white',
  db: 'bg-indigo-600 text-white',
  ws: 'bg-teal-600 text-white',
  user: 'bg-pink-600 text-white',
};

export function LogsPage() {
  const [selectedLevels, setSelectedLevels] = useState<Set<LogLevel>>(new Set(['info', 'warn', 'error']));
  const [selectedCategories, setSelectedCategories] = useState<Set<LogCategory>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [live, setLive] = useState(true);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const levelParam = [...selectedLevels].join(',');
  const categoryParam = [...selectedCategories].join(',');

  const { data, refetch } = useQuery({
    queryKey: ['logs', levelParam, categoryParam, searchText],
    queryFn: () => apiGet<{ entries: LogEntry[]; total: number }>(
      `/logs?limit=200${levelParam ? `&level=${levelParam}` : ''}${categoryParam ? `&category=${categoryParam}` : ''}${searchText ? `&search=${encodeURIComponent(searchText)}` : ''}`
    ),
    refetchInterval: live ? 3000 : false,
  });

  const entries = data?.ok ? (data.data as { entries: LogEntry[] })?.entries ?? [] : [];

  // WebSocket for live logs
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/agent-runtime/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log_entry') {
          const { type, ...entry } = msg;
          setLiveLogs(prev => [...prev, entry as LogEntry].slice(-200));
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      setTimeout(() => {
        const newWs = new WebSocket(`${proto}//${window.location.host}/api/agent-runtime/ws`);
        wsRef.current = newWs;
      }, 3000);
    };

    return () => ws.close();
  }, []);

  // Auto-scroll
  const autoScroll = useRef(true);
  useEffect(() => {
    if (live && autoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [liveLogs, live]);

  const handleScroll = () => {
    if (listRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = listRef.current;
      autoScroll.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  };

  const toggleLevel = (level: LogLevel) => {
    setSelectedLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  };

  const toggleCategory = (category: LogCategory) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  };

  const allEntries = [...liveLogs, ...entries];
  // Deduplicate by id
  const seen = new Set<string>();
  const deduped = allEntries.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // Apply filters to live entries
  const filtered = deduped.filter(e =>
    selectedLevels.has(e.level) &&
    (selectedCategories.size === 0 || selectedCategories.has(e.category)) &&
    (!searchText || e.message.toLowerCase().includes(searchText.toLowerCase()))
  ).slice(0, 500);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-gray-600" />
          <h1 className="text-2xl font-bold">Logs</h1>
          <span className="text-xs text-gray-400">({entries.length + liveLogs.length} entries)</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} className="rounded" />
            <span className="text-gray-600">Live</span>
          </label>
          <button onClick={() => refetch()} className="text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Level filters */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Level:</span>
          {LOG_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                selectedLevels.has(level) ? LEVEL_BG[level] : 'bg-gray-50 text-gray-400',
              )}
            >
              {LEVEL_ICONS[level]}
              {level}
            </button>
          ))}
        </div>

        {/* Category filters */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Category:</span>
          <button
            onClick={() => setSelectedCategories(new Set())}
            className={cn(
              'px-2 py-1 rounded text-xs transition-colors',
              selectedCategories.size === 0 ? 'bg-gray-200 text-gray-700' : 'bg-gray-50 text-gray-400',
            )}
          >
            all
          </button>
          {LOG_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={cn(
                'px-2 py-1 rounded text-xs transition-colors',
                selectedCategories.has(cat) ? CATEGORY_COLORS[cat] : 'bg-gray-50 text-gray-400',
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[150px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search messages..."
            className="w-full pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pkws-500"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Log list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="bg-gray-950 rounded-xl overflow-hidden border border-gray-200"
        style={{ height: 'calc(100vh - 260px)' }}
      >
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            No log entries match the current filters.
          </div>
        )}
        <div className="font-mono text-xs leading-relaxed">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'flex items-start gap-2 px-4 py-1.5 border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors',
                entry.level === 'error' ? 'bg-red-950/20' : entry.level === 'warn' ? 'bg-amber-950/10' : '',
              )}
            >
              {/* Timestamp */}
              <span className="text-gray-500 shrink-0 w-16 text-right">
                {entry.timestamp.slice(11, 23)}
              </span>

              {/* Level badge */}
              <span className={cn(
                'shrink-0 w-12 text-center rounded text-[10px] font-semibold px-1 py-0.5',
                LEVEL_BG[entry.level],
              )}>
                {entry.level.toUpperCase()}
              </span>

              {/* Category badge */}
              <span className={cn(
                'shrink-0 rounded text-[10px] px-1.5 py-0.5 font-medium',
                CATEGORY_COLORS[entry.category],
              )}>
                {entry.category}
              </span>

              {/* Message */}
              <span className={cn(
                'flex-1 min-w-0',
                LEVEL_COLORS[entry.level],
              )}>
                {entry.message}
                {entry.caseId && (
                  <span className="text-gray-600 ml-2">[{entry.caseId}]</span>
                )}
              </span>

              {/* Expandable data */}
              {entry.dataJson && (
                <button
                  onClick={() => {
                    const el = document.getElementById(`log-data-${entry.id}`);
                    if (el) el.classList.toggle('hidden');
                  }}
                  className="text-gray-600 hover:text-gray-400 shrink-0 text-[10px]"
                >
                  JSON
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
