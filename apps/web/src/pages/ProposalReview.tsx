import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import { cn, timeAgo } from '../lib/utils.js';
import type { CaseDetail, Proposal } from '@pkws/shared';
import {
  ArrowLeft, Bot, CheckCircle2, XCircle, Trash2, RotateCcw,
  FilePlus, MessageSquare, Lightbulb, Target, AlertTriangle,
  Move, FileOutput, FileText, ListPlus, Sparkles, RefreshCw,
  Loader2, ExternalLink
} from 'lucide-react';

const ACTION_LABELS: Record<string, { label: string; icon: React.ElementType; description: string }> = {
  mark_done: { label: 'Mark Done', icon: CheckCircle2, description: 'No vault changes needed' },
  drop: { label: 'Drop', icon: XCircle, description: 'Discard this case' },
  move: { label: 'Move', icon: Move, description: 'Move file to another location' },
  append_summary: { label: 'Append Summary', icon: FileOutput, description: 'Add AI summary to the file' },
  update_frontmatter: { label: 'Update Frontmatter', icon: FileText, description: 'Add/update metadata fields' },
  generate_formal_note: { label: 'Formal Note', icon: Sparkles, description: 'Create a polished note from the content' },
  create_index_link: { label: 'Create Index Link', icon: ListPlus, description: 'Add an entry to an index note' },
  merge_later: { label: 'Merge Later', icon: FilePlus, description: 'Combine with related content later' },
  need_more_research: { label: 'More Research', icon: Lightbulb, description: 'Need additional context before deciding' },
};

function ValueBadge({ value }: { value: string }) {
  return (
    <span className={cn(
      'text-xs px-2 py-0.5 rounded-full font-medium',
      value === 'high' ? 'bg-green-100 text-green-700' :
      value === 'medium' ? 'bg-blue-100 text-blue-700' :
      value === 'low' ? 'bg-amber-100 text-amber-700' :
      'bg-gray-100 text-gray-600'
    )}>
      {value}
    </span>
  );
}

export function ProposalReviewPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  // Query case detail to get proposals
  const { data, isLoading } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => apiGet<CaseDetail>(`/cases/${caseId}`),
    refetchInterval: 5_000,
  });

  const caseDetail = data?.ok ? data.data : null;
  const c = caseDetail?.case;
  const proposal = caseDetail?.currentProposal;

  // Fetch all proposals for history
  const { data: proposalsData } = useQuery({
    queryKey: ['proposals', caseId],
    queryFn: () => apiGet<Proposal[]>(`/cases/${caseId}/proposals`),
  });
  const allProposals = proposalsData?.ok ? proposalsData.data : [];

  // Mutations
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

  const commentMutation = useMutation({
    mutationFn: (comment: string) => apiPost(`/cases/${caseId}/comment`, { comment, updateInstructionSummary: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  // Generate patch intent for a specific action
  const patchIntentMutation = useMutation({
    mutationFn: (action: string) => apiPost(`/cases/${caseId}/patch-intents`, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      navigate(`/cases/${caseId}`);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!caseDetail || !c) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <p className="text-gray-500">Case not found</p>
        <button onClick={() => navigate('/')} className="mt-4 text-sm text-pkws-600 hover:underline">
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Determine which actions need a patch (vault modification)
  const needsPatchActions = ['move', 'append_summary', 'update_frontmatter', 'generate_formal_note', 'create_index_link'];
  const noPatchActions = ['mark_done', 'drop', 'merge_later', 'need_more_research'];

  const suggestedPatchActions = (proposal?.suggestedActions || []).filter(a => needsPatchActions.includes(a));
  const suggestedNoPatchActions = (proposal?.suggestedActions || []).filter(a => noPatchActions.includes(a));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header with back button */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => navigate(`/cases/${caseId}`)} className="mt-1 text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold truncate">Proposal Review</h1>
            {c.status && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', 'bg-amber-100 text-amber-800')}>
                {c.status}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 truncate">
            {c.title}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Case {caseId} · Updated {timeAgo(c.updatedAt)}
          </p>
        </div>
      </div>

      {/* AI Proposal */}
      {proposal ? (
        <div className="bg-white rounded-xl border border-blue-100 shadow-sm overflow-hidden mb-6">
          {/* Proposal header */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-blue-100">
            <div className="flex items-center gap-2 mb-1">
              <Bot className="w-5 h-5 text-blue-600" />
              <h2 className="font-semibold text-gray-900">AI Proposal</h2>
              <span className="text-xs text-gray-400 ml-auto">Model: {proposal.model}</span>
            </div>
            <p className="text-xs text-gray-500">
              Generated {timeAgo(proposal.createdAt)}
            </p>
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* Title */}
            <div>
              <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                <Target className="w-3 h-3" />
                Suggested Title
              </div>
              <p className="text-lg font-semibold text-gray-900">{proposal.title}</p>
            </div>

            {/* Summary */}
            <div>
              <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider mb-1.5">
                <Lightbulb className="w-3 h-3" />
                Summary
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{proposal.summary}</p>
            </div>

            {/* Value & Path row */}
            <div className="flex flex-wrap gap-6">
              <div>
                <span className="text-xs text-gray-400 block mb-1">Value</span>
                <ValueBadge value={proposal.valueJudgement} />
              </div>
              {proposal.suggestedTargetPath && (
                <div className="min-w-0 flex-1">
                  <span className="text-xs text-gray-400 block mb-1">Suggested Path</span>
                  <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-700 break-all">
                    {proposal.suggestedTargetPath}
                  </code>
                </div>
              )}
            </div>

            {/* Suggested Actions (needs patch) */}
            {suggestedPatchActions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider mb-2">
                  <FileOutput className="w-3 h-3" />
                  Actions that modify Vault
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {suggestedPatchActions.map(action => {
                    const meta = ACTION_LABELS[action];
                    const Icon = meta?.icon || FileOutput;
                    return (
                      <button
                        key={action}
                        onClick={() => patchIntentMutation.mutate(action)}
                        disabled={patchIntentMutation.isPending}
                        className="flex items-start gap-3 p-3 bg-white border border-purple-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-all text-left group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center shrink-0 group-hover:bg-purple-200 transition-colors">
                          <Icon className="w-4 h-4 text-purple-700" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{meta?.label || action}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{meta?.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Suggested Actions (no patch needed) */}
            {suggestedNoPatchActions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider mb-2">
                  <CheckCircle2 className="w-3 h-3" />
                  Quick actions (no vault changes)
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedNoPatchActions.map(action => {
                    const meta = ACTION_LABELS[action];
                    const Icon = meta?.icon || CheckCircle2;
                    const isDestructive = action === 'drop';
                    return (
                      <button
                        key={action}
                        onClick={() => {
                          if (action === 'mark_done') markDoneMutation.mutate();
                          else if (action === 'drop') {
                            if (confirm('Are you sure you want to drop this case?')) dropMutation.mutate();
                          }
                        }}
                        disabled={markDoneMutation.isPending || dropMutation.isPending}
                        className={cn(
                          'flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-all',
                          isDestructive
                            ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                            : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {meta?.label || action}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Reasoning */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider mb-2">
                <Lightbulb className="w-3 h-3" />
                Reasoning
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{proposal.reasoningSummary}</p>
            </div>

            {/* Risks */}
            {proposal.risks && proposal.risks.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-xs text-amber-700 uppercase tracking-wider mb-2">
                  <AlertTriangle className="w-3 h-3" />
                  Risks & Uncertainties
                </div>
                <ul className="space-y-1">
                  {proposal.risks.map((risk, i) => (
                    <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                      <span className="mt-0.5">•</span>
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* No proposal state */
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
            <Bot className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">No Proposal Yet</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            {c?.status === 'Captured' || c?.status === 'Analyzing'
              ? 'The AI is analyzing this content. A proposal will appear here once ready.'
              : 'This case does not have a current proposal. Try regenerating one.'}
          </p>
          <button
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {regenerateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Generate Proposal
          </button>
        </div>
      )}

      {/* Action toolbar */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => markDoneMutation.mutate()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 border border-green-200"
        >
          <CheckCircle2 className="w-4 h-4" /> Mark Done
        </button>
        <button
          onClick={() => {
            if (confirm('Are you sure you want to drop this case?')) dropMutation.mutate();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100 border border-red-200"
        >
          <Trash2 className="w-4 h-4" /> Drop
        </button>
        <button
          onClick={() => regenerateMutation.mutate()}
          disabled={regenerateMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200"
        >
          <RotateCcw className={cn('w-4 h-4', regenerateMutation.isPending && 'animate-spin')} />
          Regenerate
        </button>
        <button
          onClick={() => navigate(`/cases/${caseId}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 border border-gray-200"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Case
        </button>
      </div>

      {/* Comment / Instruction */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-medium">Add Instruction for Regeneration</h3>
        </div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
          placeholder="Tell the AI what you'd like to change about its approach..."
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
            {commentMutation.isPending ? 'Sending...' : 'Send & Regenerate'}
          </button>
        </div>
      </div>

      {/* Proposal history */}
      {allProposals.length > 1 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium mb-3">Proposal History ({allProposals.length})</h3>
          <div className="space-y-2">
            {allProposals.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 text-sm p-2 rounded hover:bg-gray-50">
                <span className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                  i === 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                )}>
                  {allProposals.length - i}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-700 truncate">{p.title}</p>
                  <p className="text-xs text-gray-400">{p.model} · {timeAgo(p.createdAt)}</p>
                </div>
                <ValueBadge value={p.valueJudgement} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
