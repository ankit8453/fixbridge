'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale } from '@/i18n/useT';
import { useAuth } from '@/lib/auth/useAuth';
import { Button } from '@/components/ui';
import { AdminLink } from './AdminLink';

/**
 * The left nav + header chrome, replacing apps/admin/src/components/Layout.tsx.
 *
 * The original was `<Outlet />` inside a react-router pathless layout route;
 * here it wraps `{children}` directly from `[locale]/admin/layout.tsx`.
 * Left nav, always visible — ops move between queues constantly, and a nav
 * that collapses on a tablet turns every hop into two taps (this surface is
 * desktop-first by design, see PHASE12_PROMPT.md §D "usable on a tablet").
 */
const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/verification', label: 'Verification' },
  { href: '/providers', label: 'Technicians' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/complaints', label: 'Complaints' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/money', label: 'Money' },
  { href: '/queues', label: 'Queues' },
  { href: '/audit', label: 'Audit log' },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, roles, logout } = useAuth();
  const pathname = usePathname();
  const locale = useLocale();
  const adminRoot = buildLocalizedHref(locale, '/admin');

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === adminRoot;
    return pathname.startsWith(`${adminRoot}${href}`);
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <nav className="w-52 shrink-0 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold">Operations</div>
          <div className="text-xs text-slate-500">console</div>
        </div>
        <ul className="p-2">
          {NAV.map((item) => (
            <li key={item.href}>
              <AdminLink
                href={item.href}
                className={`block rounded px-3 py-1.5 text-sm ${
                  isActive(item.href)
                    ? 'bg-slate-900 font-medium text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </AdminLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-2.5">
          <div className="text-xs text-slate-500">
            Signed in as{' '}
            <span className="font-medium text-slate-800">{user?.name ?? user?.phone ?? '—'}</span>
            <span className="ml-2 text-slate-400">{roles.join(', ')}</span>
          </div>
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
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
  actions?: ReactNode;
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
