'use client';

import { type ReactNode } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { RoleNav } from '@/components/shell/RoleNav';
import { Spinner } from '@/components/ui/States';
import { useT } from '@/i18n/useT';
import { BecomePartnerGate } from './BecomePartnerGate';
import { PartnerTabBar } from './PartnerTabBar';

/**
 * The one gate every `/partner` route renders behind.
 *
 * `layout.tsx` only proves a session cookie exists (see
 * `lib/auth/server-guard.ts` — it cannot see roles). Whether that session
 * holds `technician` can only be known once the access token is in memory, so
 * that split lives here instead: signed-in-but-not-yet-a-partner sees the
 * registration screen in place of `children`, on every `/partner/*` URL,
 * rather than each page re-deriving the same check or a customer being
 * bounced to `/login` for a role they simply have not claimed yet. This is
 * deliberately not `RequireRole` (`lib/auth/guards.tsx`) — that guard
 * redirects away entirely, and redirecting a signed-in customer who typed
 * `/partner` would hide the one screen that lets them become one.
 */
export function PartnerShell({ children }: { children: ReactNode }) {
  const { status, roles } = useAuth();
  const t = useT();
  const isTechnician = roles.includes('technician');

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <RoleNav />
      <div className="flex-1 pb-20">
        {status === 'restoring' ? (
          <Spinner label={t('partner.common.loading')} />
        ) : isTechnician ? (
          children
        ) : (
          <BecomePartnerGate />
        )}
      </div>
      {isTechnician ? <PartnerTabBar /> : null}
    </div>
  );
}
