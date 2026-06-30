import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import { cn, timeAgo } from '../lib/utils.js';
import { PatchDiff } from '../components/PatchDiff.js';
import type { CaseDetail, PatchPreview } from '@pkws/shared';
import {
  ArrowLeft, CheckCircle2, XCircle, RotateCcw, FileOutput,
  AlertTriangle, Loader2, Info
} from 'lucide-react';

export function PatchPreviewPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Get case detail
  const { data: caseData, isLoading: isCaseLoading } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => apiGet<CaseDetail>(`/cases/${caseId}`),
    refetchInterval: 5_000,
  });

  const caseDetail = caseData?.ok ? caseData.data : null;
  const c = caseDetail?.case;
  const patch = caseDetail?.currentPatch;

  // Get full patch preview with operations
  const { data: patchData, isLoading: isPatchLoading } = useQuery({
    queryKey: ['patch-preview', caseId, patch?.id],
    queryFn: () => patch ? apiGet<PatchPreview>(`/cases/${caseId}/patches/${patch.id}`) : Promise.reject(),
    enabled: !!patch && patch.status === 'preview',
    refetchInterval: 3_000,
  });

  const patchPreview = patchData?.ok ? patchData.data : null;
  const operations = patchPreview?.operations || [];

  // Approve & Apply
  const approveMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/patches/${patch?.id}/approve-apply`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['case', caseId] }),
  });

  // Reject
  const rejectMutation = useMutation({
    mutationFn: () => apiPost(`/cases/${caseId}/patches/${patch?.id}/reject`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['case', caseId] }); },
  });

  const isLoading = isCaseLoading || isPatchLoading;

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-48 bg-gray-100 rounded" />
          <div className="h-96 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!caseDetail || !c) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-12">
        <p className="text-gray-500">Case not found</p>
      </div>
    );
  }

  // Case is applying — show progress
  if (c.status === 'Applying' || c.status === 'Approved') {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-16">
        <Loader2 className="w-12 h-12 mx-auto mb-4 text-purple-500 animate-spin" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Applying Patch...</h2>
        <p className="text-sm text-gray-500">
          The patch is being applied to your vault. This should complete momentarily.
        </p>
      </div>
    );
  }

  // Case is done
  if (c.status === 'Done') {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-16">
        <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Patch Applied Successfully</h2>
        <p className="text-sm text-gray-500 mb-6">The changes have been written to your vault.</p>
        <button
          onClick={() => navigate(`/cases/${caseId}`)}
          className="px-4 py-2 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700"
        >
          Back to Case
        </button>
      </div>
    );
  }

  // Error state
  if (c.status === 'Error') {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-16">
        <XCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Apply Failed</h2>
        <p className="text-sm text-gray-500 mb-6">
          Something went wrong while applying the patch. Check the timeline for details.
        </p>
        <button
          onClick={() => navigate(`/cases/${caseId}`)}
          className="px-4 py-2 text-sm bg-pkws-600 text-white rounded-lg hover:bg-pkws-700"
        >
          Back to Case
        </button>
      </div>
    );
  }

  // No patch state
  if (!patch || (patch.status !== 'preview' && patch.status !== 'approved')) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16">
          <FileOutput className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">No Patch Available</h2>
          <p className="text-sm text-gray-500 mb-6">
            This case does not have a patch in preview. Generate one from the Proposal Review page.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(`/cases/${caseId}/proposal`)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Go to Proposal
            </button>
            <button
              onClick={() => navigate(`/cases/${caseId}`)}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
            >
              Back to Case
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Patch was already approved but not yet applied
  if (patch.status === 'approved') {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-16">
        <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-purple-500" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Patch Approved</h2>
        <p className="text-sm text-gray-500 mb-6">
          This patch has been approved and is waiting to be applied.
        </p>
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-purple-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => navigate(`/cases/${caseId}`)} className="mt-1 text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold">Patch Preview</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800">
              Preview
            </span>
          </div>
          <p className="text-sm text-gray-500 truncate">{c.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {operations.length} operation(s) · Case {caseId}
          </p>
        </div>
      </div>

      {/* Warning banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800">Review Before Applying</p>
          <p className="text-xs text-amber-700 mt-0.5">
            This patch will modify files in your Obsidian vault. A backup will be created before applying.
            Changes can be rolled back after application.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      {patchPreview?.affectedFiles && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{operations.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Operations</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{patchPreview.affectedFiles.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Files Affected</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">
              {operations.filter(o => o.type === 'create_file').length}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">New Files</p>
          </div>
        </div>
      )}

      {/* Diff view */}
      {operations.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Changes</h3>
          <PatchDiff operations={operations} />
        </div>
      )}

      {/* Operation list (compact) */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <h3 className="text-sm font-medium mb-3">All Operations</h3>
        <div className="space-y-1">
          {operations.map((op, i) => (
            <div key={i} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-gray-50">
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded font-medium',
                op.type === 'create_file' ? 'bg-green-100 text-green-700' :
                op.type === 'update_file' ? 'bg-blue-100 text-blue-700' :
                'bg-purple-100 text-purple-700'
              )}>
                {op.type === 'create_file' ? 'CREATE' : op.type === 'update_file' ? 'UPDATE' : 'MOVE'}
              </span>
              <span className="font-mono text-xs text-gray-600 truncate">
                {(op.type === 'move_file' && 'fromPath' in op)
                  ? `${(op as any).fromPath} → ${(op as any).toPath}`
                  : (op as any).path || (op as any).fromPath || ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-sm">Ready to apply?</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              A backup will be created before applying. You can rollback afterward if needed.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (confirm('Are you sure you want to reject this patch?')) {
                  rejectMutation.mutate();
                }
              }}
              disabled={rejectMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
            <button
              onClick={() => {
                if (confirm(`Apply ${operations.length} operation(s) to your vault? A backup will be created.`)) {
                  approveMutation.mutate();
                }
              }}
              disabled={approveMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {approveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Approve & Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
