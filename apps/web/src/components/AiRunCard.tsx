import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AiRun, ProposedNextAction } from '@pkws/shared';
import { cn, timeAgo } from '../lib/utils.js';
import {
  Bot, CheckCircle2, XCircle, Loader2, Ban, ArrowRight,
  FileOutput, MessageSquare, Lightbulb, RefreshCw,
  Clock, Database, Brain, ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';

/**
 * Per-node AI run card (line 4 / task #14).
 *
 * Renders ONE ai_runs row transparently — what the AI was fed (rules
 * snapshot + input context, truncated by char count with an expand toggle)
 * and what it produced (summary + proposedNextActions menu + the produced
 * proposal's link). Mirrors the ProposalReview styling and matches the
 * surrounding card border/space idiom of CaseDetail.
 *
 * No vault-writing buttons here — invoking next-step actions stays a
 * ProposalReview concern; AiRunCard is read-only transparency.
 */

// ---- status pill ----
const STATUS_STYLE: Record<AiRun['status'], { icon: React.ElementType; label: string; classes: string }> = {
  running:   { icon: Loader2,      label: 'Running',   classes: 'bg-blue-50 text-blue-700 border-blue-200' },
  succeeded: { icon: CheckCircle2, label: 'Succeeded', classes: 'bg-green-50 text-green-700 border-green-200' },
  failed:    { icon: XCircle,       label: 'Failed',    classes: 'bg-red-50 text-red-700 border-red-200' },
  aborted:   { icon: Ban,           label: 'Aborted',   classes: 'bg-gray-100 text-gray-500 border-gray-200' },
};

// ---- kind pill ----
const KIND_STYLE: Record<AiRun['kind'], { label: string; classes: string }> = {
  proposal: { label: 'Proposal', classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  turn:     { label: 'Turn',      classes: 'bg-purple-50 text-purple-700 border-purple-200' },
};

// ---- trigger label ----
const TRIGGER_LABEL: Record<AiRun['trigger'], string> = {
  user_explicit:     'User: analyze',
  user_regenerate:   'User: regenerate',
  user_invoke_next:  'User: invoke next',
  auto_analyze:      'Auto: inbox scan',
};

// ---- proposed-action side-effect styling (mirrors ProposalReview's palette) ----
const SIDE_EFFECT_STYLE: Record<string, { icon: React.ElementType; accent: string }> = {
  modify_vault: { icon: FileOutput,    accent: 'purple' },
  quick_close:  { icon: CheckCircle2,  accent: 'green' },
  ask_user:     { icon: MessageSquare, accent: 'gray' },
  clarify:      { icon: MessageSquare, accent: 'gray' },
  regenerate:   { icon: RefreshCw,     accent: 'gray' },
};
function sideEffectStyle(sideEffect: string) {
  return SIDE_EFFECT_STYLE[sideEffect] ?? { icon: Lightbulb, accent: 'gray' };
}

// Default char cap for any displayed "material" blob. The user explicitly
// asked: each kind of input shows a char-count-truncated excerpt with a
// toggle to expand. Bumped on expand to full string.
const DEFAULT_CHAR_CAP = 600;

/**
 * Truncate a string to `cap` chars; returns the (possibly truncated) text
 * plus whether truncation happened, so the caller can render a "show more".
 * Treats null/undefined/empty as no content.
 */
function truncateForPreview(text: string | null | undefined, cap: number) {
  if (!text) return { text: '', truncated: false };
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(0, cap), truncated: true };
}

/**
 * Render a JSON-stored material blob: pretty-printed if it parses, raw text
 * otherwise. Used for both rulesSnapshotJson and inputContextJson.
 */
function MaterialBlock({ label, json, defaultCap }: { label: string; json?: string | null; defaultCap?: number }) {
  const cap = defaultCap ?? DEFAULT_CHAR_CAP;
  const [expanded, setExpanded] = useState(false);

  const pretty = useMemo(() => {
    if (!json) return '';
    try { return JSON.stringify(JSON.parse(json), null, 2); }
    catch { return json; }       // not JSON — show raw
  }, [json]);

  const { text, truncated } = truncateForPreview(pretty, cap);
  if (!text) {
    return (
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-wider mb-1">
          <Database className="w-3 h-3" />
          {label}
        </div>
        <p className="text-xs text-gray-400 italic">— empty —</p>
      </div>
    );
  }
  const showText = expanded ? pretty : text;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase tracking-wider">
          <Database className="w-3 h-3" />
          {label}
        </div>
        <span className="text-[10px] text-gray-400 font-mono">
          {expanded ? `${pretty.length} chars` : `${text.length}/${pretty.length}`}
        </span>
      </div>
      <pre className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
        {showText}
      </pre>
      {truncated && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-xs text-pkws-600 hover:underline flex items-center gap-1"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Show less' : `Show all (${pretty.length - text.length} more chars)`}
        </button>
      )}
    </div>
  );
}

interface AiRunCardProps {
  run: AiRun;
  /** Fired when the user clicks "Open session file". Caller POSTs to the
   * open-transcript route; the route shells out to the OS's default editor. */
  onOpenTranscript?: (run: AiRun) => void;
}

export function AiRunCard({ run, onOpenTranscript }: AiRunCardProps) {
  const navigate = useNavigate();
  const status = STATUS_STYLE[run.status] ?? STATUS_STYLE.running;
  const kind = KIND_STYLE[run.kind] ?? KIND_STYLE.turn;
  const StatusIcon = status.icon;
  const triggerLabel = TRIGGER_LABEL[run.trigger] ?? run.trigger;

  // Parse proposedNextActionsJson → ProposedNextAction[]
  const nextActions: ProposedNextAction[] = useMemo(() => {
    if (!run.proposedNextActionsJson) return [];
    try {
      const parsed = JSON.parse(run.proposedNextActionsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }, [run.proposedNextActionsJson]);

  // proposalId link target — only kind='proposal' renders a real proposalId.
  const proposalLink = run.kind === 'proposal' && run.proposalId
    ? `/cases/${run.caseId}/proposal`   // ProposalReview route (current proposal)
    : null;

  return (
    <div className={cn(
      'bg-white rounded-lg border overflow-hidden',
      run.status === 'running' ? 'border-blue-200 shadow-sm' : 'border-gray-200'
    )}>
      {/* ---- header ---- */}
      <div className="flex items-start gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
        <Brain className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border', kind.classes)}>
              {kind.label}
            </span>
            <span className="text-xs text-gray-500">
              {triggerLabel}
            </span>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium border flex items-center gap-1',
              status.classes
            )}>
              <StatusIcon className={cn('w-3 h-3', run.status === 'running' && 'animate-spin')} />
              {status.label}
            </span>
            {run.model && (
              <span className="text-xs text-gray-400 font-mono ml-auto truncate max-w-[200px]">
                {run.model}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(run.startedAt)}
            </span>
            {run.durationMs !== undefined && (
              <span>{(run.durationMs / 1000).toFixed(1)}s</span>
            )}
            <span className="font-mono truncate">{run.id}</span>
          </div>
        </div>
      </div>

      {/* ---- body ---- */}
      <div className="px-4 py-3 space-y-4">
        {/* ---- material fed this turn (transparency) ---- */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wider font-medium">
            <Bot className="w-3 h-3" />
            Material fed to AI
          </div>
          <MaterialBlock label="Workspace Rules (snapshot)" json={run.rulesSnapshotJson} />
          <MaterialBlock label="Input context" json={run.inputContextJson} />
        </div>

        {/* ---- output ---- */}
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wider font-medium">
            <ArrowRight className="w-3 h-3" />
            AI output
          </div>

          {/* error (failed) */}
          {run.status === 'failed' && run.error && (
            <pre className="text-xs font-mono text-red-700 bg-red-50 border border-red-200 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-words">
              {run.error}
            </pre>
          )}

          {/* summary */}
          {run.outputSummary && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Summary</div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{run.outputSummary}</p>
            </div>
          )}

          {/* proposed next-step actions */}
          {nextActions.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Proposed next steps</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {nextActions.map(action => {
                  const style = sideEffectStyle(action.sideEffect);
                  const Icon = style.icon;
                  return (
                    <div
                      key={action.id}
                      className={cn(
                        'flex items-start gap-2 p-2.5 rounded-md border text-left',
                        style.accent === 'green'  ? 'border-green-200 bg-green-50' :
                        style.accent === 'purple' ? 'border-purple-200 bg-purple-50' :
                        'border-gray-200 bg-gray-50'
                      )}
                    >
                      <Icon className={cn(
                        'w-4 h-4 mt-0.5 shrink-0',
                        style.accent === 'green'  ? 'text-green-600' :
                        style.accent === 'purple' ? 'text-purple-600' :
                        'text-gray-500'
                      )} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">{action.label}</div>
                        {action.description && (
                          <div className="text-xs text-gray-600 mt-0.5 break-words">{action.description}</div>
                        )}
                        <span className="inline-block text-[10px] text-gray-400 font-mono mt-1">
                          sideEffect: {action.sideEffect}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Read-only note: invoking live actions happens on ProposalReview */}
              <p className="text-[11px] text-gray-400 mt-1.5">
                Invoke these on the Proposal Review page.
              </p>
            </div>
          )}

          {/* proposal jump (kind='proposal' success) */}
          {proposalLink && (
            <button
              onClick={() => navigate(proposalLink)}
              className="text-xs text-pkws-600 hover:underline flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Open proposal {run.proposalId}
            </button>
          )}

          {/* ---- session transparency ---- */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
            {run.agentId && (
              <span className="flex items-center gap-1 font-mono">
                <Brain className="w-3 h-3" />
                {run.agentId === 'claude' ? 'Claude Code' : run.agentId === 'codex' ? 'Codex CLI' : run.agentId}
              </span>
            )}
            {run.sessionId && (
              <span className="font-mono truncate max-w-[260px]" title={run.sessionId}>
                session: {run.sessionId.slice(0, 8)}…
              </span>
            )}
            {run.transcriptPath ? (
              <button
                onClick={() => onOpenTranscript?.(run)}
                className="ml-auto text-xs text-pkws-600 hover:underline flex items-center gap-1"
                title={run.transcriptPath}
              >
                <ExternalLink className="w-3 h-3" />
                Open session file
              </button>
            ) : run.sessionId ? (
              <span className="ml-auto italic text-gray-400" title="Transcript path not flushed yet">
                transcript pending
              </span>
            ) : (
              <span className="ml-auto italic text-gray-400" title="This run used an API call, not a CLI session">
                no session file (API)
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
