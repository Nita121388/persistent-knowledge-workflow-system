import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import { cn, getStatusColor, timeAgo } from '../lib/utils.js';
import type { CaseDetail, PatchPreview, Proposal, PatchIntent } from '@pkws/shared';
import { ArrowLeft, Bot, MessageSquare, CheckCircle2, XCircle, Trash2, RotateCcw, FileOutput, FilePlus, FolderOpen, FileText, Move, ExternalLink } from 'lucide-react';

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [showPatchForm, setShowPatchForm] = useState(false);
  const [patchAction, setPatchAction] = useState('move');
  const [patchTarget, setPatchTarget] = useState('');
  const [patchInstruction, setPatchInstruction] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => apiGet<CaseDetail>(`/cases/${caseId}`),
    refetchInterval: 5_000,
  });

  const caseDetail = data?.ok ? data.data : null;

  // Mutations
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

  const patchIntentMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPost(`/cases/${caseId}/patch-intents`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      setShowPatchForm(false);
    },
  });

  const approveApplyMutation = useMutation({
    mutationFn: (patchId: string) => apiPost(`/cases/${caseId}/patches/${patchId}/approve-apply`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  const rejectPatchMutation = useMutation({
    mutationFn: (patchId: string) => apiPost(`/cases/${caseId}/patches/${patchId}/reject`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  const rollbackMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/rollback`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/reopen`, { reason: '' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
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
  const patch = caseDetail.currentPatch;
  const timeline = caseDetail.timeline || [];
  const patchIntents = caseDetail.patchIntents || [];

  const canModify = ['ReviewRequired', 'NeedDiscussion', 'PatchPreview', 'Approved'].includes(c.status);
  const showProposal = proposal && ['ReviewRequired', 'NeedDiscussion', 'PatchPreview', 'Approved'].includes(c.status);
  const showPatch = patch && patch.status === 'preview';

  const handleBrowseDir = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.display = 'none';

    input.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        const fullPath = files[0].webkitRelativePath;
        const dirPath = fullPath.substring(0, fullPath.length - files[0].webkitRelativePath.length);
        // Extract relative path from vault root if possible
        const vaultPath = caseDetail?.anchor?.currentVaultPath || '';
        if (vaultPath && dirPath.startsWith(vaultPath)) {
          setPatchTarget(dirPath.substring(vaultPath.length).replace(/^[\/\\]/, '') + '/');
        } else {
          setPatchTarget(dirPath.replace(/\/$/, '') + '/');
        }
      }
    });

    document.body.appendChild(input);
    input.click();
    setTimeout(() => document.body.removeChild(input), 1000);
  };

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
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200"
          >
            <RotateCcw className="w-4 h-4" /> Regenerate
          </button>
          <button
            onClick={() => setShowPatchForm(!showPatchForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 border border-purple-200"
          >
            <FilePlus className="w-4 h-4" /> Generate Patch
          </button>
          {c.status === 'RolledBack' && (
            <button
              onClick={() => reopenMutation.mutate()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-50 text-amber-700 rounded-lg"
            >
              <RotateCcw className="w-4 h-4" /> Reopen
            </button>
          )}
        </div>
      )}

      {/* Patch form */}
      {showPatchForm && (
        <div className="bg-white rounded-lg border border-purple-200 p-4 mb-6">
          <h3 className="font-medium text-sm mb-3">Generate Patch</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Action</label>
              <select
                value={patchAction}
                onChange={e => setPatchAction(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="move">Move file</option>
                <option value="update_frontmatter">Update frontmatter</option>
                <option value="append_summary">Append summary</option>
                <option value="generate_formal_note">Generate formal note</option>
                <option value="create_index_link">Create index link</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Target Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={patchTarget}
                  onChange={e => setPatchTarget(e.target.value)}
                  placeholder="e.g., Resource/AI Tools/article.md"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={handleBrowseDir}
                  title="Browse vault folders"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span className="hidden sm:inline">Browse</span>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Relative to vault root, or leave blank for AI to decide</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Instructions (optional)</label>
              <textarea
                value={patchInstruction}
                onChange={e => setPatchInstruction(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Any specific instructions for generating this patch"
              />
            </div>
            <button
              onClick={() => patchIntentMutation.mutate({
                action: patchAction,
                targetPath: patchTarget || undefined,
                instruction: patchInstruction || undefined,
              })}
              disabled={patchIntentMutation.isPending}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {patchIntentMutation.isPending ? 'Generating...' : 'Generate Patch'}
            </button>
          </div>
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
              <span className="text-xs text-gray-500 block mb-1">Suggested Actions</span>
              <div className="flex flex-wrap gap-1.5">
                {proposal.suggestedActions.map((a: string) => (
                  <span key={a} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    {a}
                  </span>
                ))}
              </div>
            </div>

            {proposal.suggestedTargetPath && (
              <div>
                <span className="text-xs text-gray-500 block mb-0.5">Suggested Path</span>
                <p className="text-sm font-mono text-gray-600">{proposal.suggestedTargetPath}</p>
              </div>
            )}

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

      {/* Patch preview */}
      {showPatch && patch && (
        <div className="bg-white rounded-lg border border-amber-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileOutput className="w-5 h-5 text-amber-600" />
              <h2 className="font-semibold">Patch Preview</h2>
              <button
                onClick={() => navigate(`/cases/${caseId}/patch`)}
                className="ml-2 text-xs text-amber-600 hover:text-amber-800 hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> Full Details
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => approveApplyMutation.mutate(patch.id)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <CheckCircle2 className="w-4 h-4" /> Approve & Apply
              </button>
              <button
                onClick={() => rejectPatchMutation.mutate(patch.id)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              >
                <XCircle className="w-4 h-4" /> Reject
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {(patch as any).operations?.map((op: any, i: number) => (
              <div key={i} className="bg-gray-50 rounded p-3 text-sm">
                <span className="font-medium text-gray-700">
                  {op.type === 'create_file' && <><FileText className="w-4 h-4 inline mr-1 text-green-600" /> New</>}
                  {op.type === 'update_file' && <><FileOutput className="w-4 h-4 inline mr-1 text-blue-600" /> Update</>}
                  {op.type === 'move_file' && <><Move className="w-4 h-4 inline mr-1 text-purple-600" /> Move</>}
                </span>
                <div className="mt-1 font-mono text-xs text-gray-500">
                  {op.type === 'move_file' ? (
                    <><span className="line-through">{op.fromPath}</span> → <span>{op.toPath}</span></>
                  ) : (
                    op.path
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rollback button for Done or Error cases */}
      {['Done', 'Error'].includes(c.status) && (
        <div className="bg-white rounded-lg border border-red-100 p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm">Rollback</h3>
              <p className="text-xs text-gray-500 mt-0.5">Revert the last apply for this case</p>
            </div>
            <button
              onClick={() => {
                if (confirm('Are you sure you want to rollback?')) {
                  rollbackMutation.mutate();
                }
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
            >
              <RotateCcw className="w-4 h-4" /> Rollback
            </button>
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

      {/* Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium mb-3">Timeline</h3>
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
