import { Loader2 } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-pkws-600 mx-auto mb-3" />
        <p className="text-sm text-gray-500">Loading PKWS...</p>
      </div>
    </div>
  );
}
