import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString();
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'Captured':
    case 'Analyzing':
      return 'bg-blue-100 text-blue-800';
    case 'ReviewRequired':
    case 'NeedDiscussion':
      return 'bg-amber-100 text-amber-800';
    // PatchPreview / Approved / Applying / RolledBack are legacy patch-
    // orchestration statuses from line 1. They will only ever appear on
    // rows already in the DB and never on new cases, so a neutral gray
    // (the default fallback) is appropriate. They will be removed in
    // task #16 once the agent-runtime writers retire for good.
    case 'Done':
      return 'bg-green-100 text-green-800';
    case 'Dropped':
    case 'Rejected':
      return 'bg-gray-100 text-gray-600';
    case 'Error':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
