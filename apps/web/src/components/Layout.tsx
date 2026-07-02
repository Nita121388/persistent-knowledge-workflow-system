import { Link, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { LayoutDashboard, Settings2, Cpu, ScrollText, Github } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/agent-runtime', label: 'Agents', icon: Cpu },
  { path: '/logs', label: 'Logs', icon: ScrollText },
  { path: '/settings', label: 'Settings', icon: Settings2 },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-6 h-6 bg-pkws-600 rounded flex items-center justify-center">
                <span className="text-white text-xs font-bold">K</span>
              </div>
              <span className="font-semibold text-sm hidden sm:inline">PKWS</span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
                <Link
                  key={path}
                  to={path}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                    location.pathname === path || (path === '/settings' && location.pathname.startsWith('/settings')) || (path === '/agent-runtime' && location.pathname.startsWith('/agent-runtime')) || (path === '/logs' && location.pathname.startsWith('/logs'))
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-500 hover:text-gray-700'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">v0.1.0</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main>{children}</main>
    </div>
  );
}
