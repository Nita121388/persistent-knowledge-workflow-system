import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import { cn, getStatusColor, timeAgo } from '../lib/utils.js';
import type { CaseDetail, Proposal } from '@pkws/shared';
import { AiRunCard } from '../components/AiRunCard.js';
import { ArrowLeft, Bot, MessageSquare, CheckCircle2, XCircle, Trash2, RotateCcw, FileOutput, FilePlus, FolderOpen, FileText, Move, ExternalLink, BookOpen, Loader2 } from 'lucide-react';

/** Open a vault file in Obsidian using obsidian:// URI */
function openInObsidian(vaultPath: string, fileFullPath: string) {
  const normalizedPath = fileFullPath.replace(/\\/g, '/');
  // obsidian://open?path= uses absolute filesystem path (more reliable than vault+file)
  const pathParam = encodeURIComponent(normalizedPath);
  window.open(`obsidian://open?path=${pathParam}`, '_blank');
}

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => apiGet<CaseDetail>(`/cases/${caseId}`),
    refetchInterval: 5_000,
  });

  const caseDetail = data?.ok ? data.data : null;

  // Mutations
  const analyzeMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/analyze`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  const cancelAnalysisMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/cancel-analysis`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  const commentMutation = useMutation({
    mutationFn: (comment: string) => apiPost(`/cases/${caseId}/comment`, { comment, updateInstructionSummary: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  const markDoneMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/mark-done`, { note: '' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['case', caseId] }); navigate('/'); },
  });

  const dropMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/drop`, { reason: '' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['case', caseId] }); navigate('/'); },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/proposals/regenerate`, { reason: 'user_requested' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  // Open this AI run's transcript jsonl in the user's default editor. Server
  // routes the path to `start`/`open`/`xdg-open`. No data refresh needed —
  // we just notify the user on failure (e.g. when a run used the API path
  // and has no transcript file).
  const openTranscriptMutation = useMutation({
    mutationFn: (runId: string) => apiPost(`/cases/${caseId}/ai-runs/${runId}/open-transcript`),
    onError: (e: any) => {
      const msg = e?.message ?? '无法打开会话文件';
      window.alert(msg);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded" />
          <div className="h-64 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!caseDetail) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <p className="text-gray-500">Case not found</p>
      </div>
    );
  }

  const c = caseDetail.case;
  const proposal = caseDetail.currentProposal;
  const timeline = caseDetail.timeline || [];

  // PatchPreview / Approved were patch-orchestration states (line 1). Under
  // the unified ai_turn model only ReviewRequired / NeedDiscussion drive
  // the modify + show-proposal UI. Patch-era legacy rows visible from the
  // dashboard will still render their timeline and basic case info, but no
  // longer expose the comment box / proposal inline view (they can still
  // open /cases/:id/proposal explicitly if a proposal exists).
  const canModify = ['ReviewRequired', 'NeedDiscussion'].includes(c.status);
  const isCaptured = c.status === 'Captured';
  const isAnalyzing = c.status === 'Analyzing';
  const showProposal = proposal && ['ReviewRequired', 'NeedDiscussion'].includes(c.status);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => navigate('/')} className="mt-1 text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold truncate">{c.title}</h1>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium shrink-0', getStatusColor(c.status))}>
              {c.status}
            </span>
          </div>
          {caseDetail.anchor && (
            <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
              <span className="font-mono">{caseDetail.anchor.id}</span>
              <span>·</span>
              <button
                onClick={() => {
                  const input = document.createElement('input');
                  input.value = caseDetail.anchor.currentVaultPath;
                  document.body.appendChild(input);
                  input.select();
                  navigator.clipboard?.writeText(caseDetail.anchor.currentVaultPath);
                  document.body.removeChild(input);
                }}
                className="font-mono truncate max-w-[300px] hover:text-gray-600 hover:underline cursor-pointer"
                title="Click to copy path"
              >
                {caseDetail.anchor.currentVaultPath}
              </button>
              <span className="text-gray-300">·</span>
              <button
                onClick={() => openInObsidian(caseDetail.vaultPath || '', caseDetail.anchor.currentVaultPath)}
                className="flex items-center gap-1 text-gray-400 hover:text-pkws-600 transition-colors"
                title="Open in Obsidian"
              >
                <BookOpen className="w-3 h-3" />
                <span className="text-xs">Open in Obsidian</span>
              </button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            Source: {c.source} · Updated {timeAgo(c.updatedAt)}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      {canModify && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => markDoneMutation.mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 border border-green-200"
          >
            <CheckCircle2 className="w-4 h-4" /> Mark Done
          </button>
          <button
            onClick={() => dropMutation.mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 border border-red-200"
          >
            <Trash2 className="w-4 h-4" /> Drop
          </button>
          <button
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all',
              regenerateMutation.isPending
                ? 'bg-blue-100 text-blue-400 border-blue-200 cursor-not-allowed'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200'
            )}
          >
            {regenerateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Regenerating...</>
            ) : (
              <><RotateCcw className="w-4 h-4" /> Regenerate</>
            )}
          </button>
        </div>
      )}

      {/* Analyze button for Captured state */}
      {isCaptured && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-50 transition-colors"
          >
            {analyzeMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
            ) : (
              <><Bot className="w-4 h-4" /> Generate Proposal</>
            )}
          </button>
          <button
            onClick={() => dropMutation.mutate()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 border border-red-200"
          >
            <Trash2 className="w-4 h-4" /> Drop
          </button>
        </div>
      )}

      {/* Analyzing state - show progress + cancel */}
      {isAnalyzing && (
        <div className="flex flex-wrap gap-2 mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-700 flex-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>AI is analyzing this case...</span>
          </div>
          <button
            onClick={() => cancelAnalysisMutation.mutate()}
            disabled={cancelAnalysisMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-red-600 rounded-lg hover:bg-red-50 border border-red-200 transition-colors"
          >
            <XCircle className="w-4 h-4" /> Cancel
          </button>
        </div>
      )}

      {/* Proposal section */}
      {showProposal && proposal && (
        <div className="bg-white rounded-lg border border-blue-100 p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Bot className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold">AI Proposal</h2>
            <span className="text-xs text-gray-400">({proposal.model})</span>
            <button
              onClick={() => navigate(`/cases/${caseId}/proposal`)}
              className="ml-auto text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" /> Full Review
            </button>
          </div>

          {/* AI Input Context - what we sent to AI */}
          <details className="mb-4">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
              View AI input context
            </summary>
            <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs font-mono text-gray-600 max-h-96 overflow-y-auto whitespace-pre-wrap">
              {caseDetail.artifact?.frontmatterJson && `## Note Metadata (frontmatter)
${caseDetail.artifact.frontmatterJson}

`}
              {caseDetail.instructionSummary && `## User Feedback from Previous Analysis
${caseDetail.instructionSummary.summary}

`}
              {proposal.rawJson && `## Proposal Output (raw)
${proposal.rawJson.slice(0, 1000)}${(proposal.rawJson.length > 1000) ? '\n... (truncated)' : ''}
`}
            </div>
          </details>

          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 block mb-0.5">Suggested Title</span>
              <p className="font-medium">{proposal.title}</p>
            </div>

            <div>
              <span className="text-xs text-gray-500 block mb-0.5">Summary</span>
              <p className="text-sm text-gray-700">{proposal.summary}</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Value:</span>
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                proposal.valueJudgement === 'high' ? 'bg-green-100 text-green-700' :
                proposal.valueJudgement === 'medium' ? 'bg-blue-100 text-blue-700' :
                proposal.valueJudgement === 'low' ? 'bg-amber-100 text-amber-700' :
                'bg-gray-100 text-gray-600'
              )}>
                {proposal.valueJudgement}
              </span>
            </div>

            <div>
              <span className="text-xs text-gray-500 block mb-1">Proposed Next Steps</span>
              <div className="flex flex-wrap gap-1.5">
                {proposal.proposedNextActions.map(a => (
                  <span key={a.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    {a.label}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs text-gray-500 block mb-0.5">Reasoning</span>
              <p className="text-sm text-gray-700">{proposal.reasoningSummary}</p>
            </div>

            {proposal.risks && proposal.risks.length > 0 && (
              <div>
                <span className="text-xs text-amber-600 block mb-0.5">Risks</span>
                <ul className="text-sm text-amber-700 list-disc list-inside">
                  {proposal.risks.map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Comment box */}
      {canModify && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-medium">Add Comment / Instruction</h3>
          </div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
            placeholder="Add an instruction or comment to guide the AI..."
          />
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (comment.trim()) {
                  commentMutation.mutate(comment);
                  setComment('');
                }
              }}
              disabled={!comment.trim() || commentMutation.isPending}
              className="px-4 py-1.5 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700 disabled:opacity-50"
            >
              {commentMutation.isPending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* AI Runs — per-node transparency (line 4 / task #15).
          Each ai_runs row is one AI invocation. The case-level proposal
          summary above stays for the at-a-glance view; this list exposes
          every node's material fed + output, newest first (the API already
          returns aiRuns ordered by createdAt desc). */}
      {(caseDetail.aiRuns?.length ?? 0) > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-gray-500" />
              AI Runs
              <span className="text-xs text-gray-400 font-normal ml-1">
                ({caseDetail.aiRuns.length})
              </span>
            </h3>
          </div>
          <div className="space-y-3">
            {caseDetail.aiRuns.map((run) => (
              <AiRunCard
                key={run.id}
                run={run}
                onOpenTranscript={(r) => openTranscriptMutation.mutate(r.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Timeline</h3>
          <a
            href={`/logs?caseId=${caseId}`}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-pkws-600 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="w-3 h-3" />
            View Logs
          </a>
        </div>
        <div className="space-y-3">
          {timeline.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No events yet</p>
          )}
          {timeline.slice(0, 30).map((event: any) => (
            <div key={event.id} className="flex items-start gap-3 text-sm">
              <div className={cn(
                'w-2 h-2 rounded-full mt-1.5 shrink-0',
                event.actor === 'user' ? 'bg-green-400' :
                event.actor === 'ai' ? 'bg-blue-400' : 'bg-gray-400'
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-gray-700">{event.summary}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {event.actor} · {timeAgo(event.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
