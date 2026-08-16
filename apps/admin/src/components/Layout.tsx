import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { Button } from './ui/Button';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/verification', label: 'Verification' },
  { to: '/providers', label: 'Technicians' },
  { to: '/bookings', label: 'Bookings' },
  { to: '/complaints', label: 'Complaints' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/money', label: 'Money' },
  { to: '/queues', label: 'Queues' },
  { to: '/audit', label: 'Audit log' },
] as const;

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Left nav, always visible. Ops move between queues constantly; a nav that
          collapses on a tablet turns every hop into two taps. */}
      <nav className="w-52 shrink-0 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold">Operations</div>
          <div className="text-xs text-slate-500">console</div>
        </div>
        <ul className="p-2">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={'end' in item ? item.end : false}
                className={({ isActive }) =>
                  `block rounded px-3 py-1.5 text-sm ${
                    isActive
                      ? 'bg-slate-900 font-medium text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-2.5">
          <div className="text-xs text-slate-500">
            Signed in as{' '}
            <span className="font-medium text-slate-800">{user?.name ?? user?.phone ?? '—'}</span>
            <span className="ml-2 text-slate-400">{(user?.roles ?? []).join(', ')}</span>
          </div>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </header>

        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
