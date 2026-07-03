import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../lib/api.js';
import { cn, timeAgo, getStatusColor } from '../lib/utils.js';
import { useToast } from '../components/Toast.js';
import type { CaseListItem } from '@pkws/shared';
import { Inbox, AlertCircle, CheckCircle2, Archive, Clock, RefreshCw, Loader2 } from 'lucide-react';

const QUEUES = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, desc: 'New captures' },
  { key: 'review', label: 'Review', icon: AlertCircle, desc: 'Awaiting decision' },
  { key: 'active', label: 'Active', icon: Clock, desc: 'In progress' },
  { key: 'closed', label: 'Closed', icon: Archive, desc: 'Done / Dropped' },
] as const;

// Maximum time to poll for scan job completion (30 seconds)
const SCAN_POLL_TIMEOUT = 30_000;
const SCAN_POLL_INTERVAL = 1_500;

interface ScanJobResult {
  scannedCount?: number;
  createdCount?: number;
  skippedCount?: number;
  errorCount?: number;
  newCaseIds?: string[];
}

export function Dashboard() {
  const [activeQueue, setActiveQueue] = useState<string>('review');
  const queryClient = useQueryClient();
  const toast = useToast();

  // Track scanning state for anti-duplicate
  const [isScanning, setIsScanning] = useState(false);
  const scanningRef = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['cases', activeQueue],
    queryFn: () => apiGet<CaseListItem[]>(`/cases?queue=${activeQueue}&limit=50`),
    refetchInterval: 10_000,
  });

  const scanMutation = useMutation({
    mutationFn: () => apiPost<any>('/inbox/scan', { mode: 'incremental' }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });

      const jobId = result.ok ? result.data?.jobId : null;
      const pendingFiles = result.ok ? result.data?.pendingFiles : 0;

      // Start polling for scan job result
      if (jobId) {
        toast.info(pendingFiles > 0
          ? `Found ${pendingFiles} file(s) in inbox, scanning...`
          : 'Scanning inbox for new files...');
        pollScanJob(jobId);
      }
    },
    onError: (err: any) => {
      setIsScanning(false);
      scanningRef.current = false;
      toast.error(`Scan failed: ${err.message || 'Unknown error'}`);
    },
    onSettled: () => {
      // Do NOT reset isScanning here — polling keeps it true until done
    },
  });

  const pollScanJob = useCallback((jobId: string) => {
    const startTime = Date.now();

    const poll = async () => {
      // Timeout check
      if (Date.now() - startTime > SCAN_POLL_TIMEOUT) {
        setIsScanning(false);
        scanningRef.current = false;
        toast.info('Scan is taking longer than expected. Refresh to see new cases.');
        return;
      }

      try {
        const res = await apiGet<any>(`/jobs/${jobId}`);
        if (res.ok && res.data) {
          const status = res.data.status;

          if (status === 'succeeded') {
            // Try to parse result
            const resultJson = res.data.resultJson;
            let result: ScanJobResult = {};
            if (resultJson) {
              try { result = JSON.parse(resultJson); } catch {}
            }

            const created = result.createdCount ?? 0;
            const skipped = result.skippedCount ?? 0;

            // Show appropriate toast
            if (created > 0) {
              toast.success(`Scan complete: ${created} new task(s) created${skipped > 0 ? `, ${skipped} skipped` : ''}`);
            } else {
              toast.info(`Scan complete — no new files found${skipped > 0 ? ` (${skipped} already pending)` : ''}`);
            }

            // Refresh case list again to show new data
            queryClient.invalidateQueries({ queryKey: ['cases'] });

            // Also auto-switch to inbox queue if new cases were created
            if (created > 0 && activeQueue !== 'inbox') {
              setTimeout(() => setActiveQueue('inbox'), 100);
            }

            setIsScanning(false);
            scanningRef.current = false;
            return;
          }

          if (status === 'failed') {
            setIsScanning(false);
            scanningRef.current = false;
            toast.error(`Scan failed: ${res.data.errorMessage || 'Unknown error'}`);
            return;
          }

          // Still running — poll again
          setTimeout(poll, SCAN_POLL_INTERVAL);
        } else {
          // Job endpoint returned error — give up polling
          setIsScanning(false);
          scanningRef.current = false;
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['cases'] });
          }, 2000);
        }
      } catch {
        // Network error — retry after interval
        setTimeout(poll, SCAN_POLL_INTERVAL);
      }
    };

    poll();
  }, [queryClient, toast, activeQueue]);

  const handleScan = useCallback(() => {
    // Anti-duplicate: use ref to prevent race conditions with React strict mode
    if (scanningRef.current) return;
    scanningRef.current = true;
    setIsScanning(true);
    scanMutation.mutate(undefined, {
      onError: () => {
        // Already handled in mutation onError — but ensure ref is reset if onSettled isn't called
        scanningRef.current = false;
        setIsScanning(false);
      },
    });
  }, [scanMutation]);

  const cases = data?.ok ? data.data : [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Knowledge Tasks</h1>
        <button
          onClick={handleScan}
          disabled={isScanning}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-all',
            isScanning
              ? 'bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-pkws-300',
          )}
        >
          {isScanning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-pkws-500" />
              <span>Scanning...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>Scan Inbox</span>
            </>
          )}
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
              <div className="mt-3 space-y-1">
                <p className="text-sm text-gray-400">
                  Use Obsidian Web Clipper to capture content first
                </p>
                <button
                  onClick={handleScan}
                  disabled={isScanning}
                  className={cn(
                    'mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-all',
                    isScanning
                      ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-white border-pkws-200 text-pkws-600 hover:bg-pkws-50',
                  )}
                >
                  {isScanning ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {isScanning ? 'Scanning...' : 'Scan Inbox Now'}
                </button>
              </div>
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
