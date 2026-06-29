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
    case 'PatchPreview':
      return 'bg-amber-100 text-amber-800';
    case 'Approved':
    case 'Applying':
      return 'bg-purple-100 text-purple-800';
    case 'Done':
      return 'bg-green-100 text-green-800';
    case 'Dropped':
    case 'Rejected':
      return 'bg-gray-100 text-gray-600';
    case 'Error':
    case 'RolledBack':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
