import { Route, Routes, useLocation } from 'react-router-dom';
import { Home, Briefcase, Wallet, ShieldCheck, CalendarClock } from 'lucide-react';
import { useAuth } from '../../lib/auth/useAuth';
import { useT } from '../../i18n/useT';
import { MobileAppShell } from '../../components/shell/MobileAppShell';
import { Card, Spinner } from '../../components/ui';
import { BecomePartnerGate } from './components/BecomePartnerGate';
import PartnerHome from './pages/PartnerHome';
import Onboarding from './pages/Onboarding';
import Verification from './pages/Verification';
import JobsInbox from './pages/JobsInbox';
import JobHistory from './pages/JobHistory';
import JobDetail from './pages/JobDetail';
import Earnings from './pages/Earnings';
import Trust from './pages/Trust';
import Slots from './pages/Slots';
import Notifications from './pages/Notifications';

/**
 * `/partner/*` — the partner (technician) surface's entry point.
 *
 * Gated with `RequireAuth` in `router.tsx`, not `RequireRole('technician')`
 * — a signed-in customer with no provider registration must still be able to
 * reach `/partner` and see a "become a partner" pitch, exactly the branch
 * `legacy-next-src/components/partner/PartnerShell.tsx` made. That split
 * lives here rather than in the route guard because whether the signed-in
 * user holds `technician` can only be known once the access token is in
 * memory (`useAuth().roles`), which the router-level guard does not inspect
 * — it only proves *someone* is signed in.
 *
 * `MobileAppShell`'s tab list mirrors `PartnerTabBar` from the legacy app:
 * the five places a technician needs most (home, jobs, money, trust, hours),
 * reachable one-handed near the bottom of the screen — the top bar
 * (`RoleNav`, mounted by `RootLayout` for every surface) stays for the
 * surface switcher and logout only.
 */
export default function PartnerAppEntry() {
  const { status, roles } = useAuth();
  const t = useT();
  const location = useLocation();
  const isTechnician = roles.includes('technician');

  if (status === 'restoring') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4">
        <Spinner label={t('partner.common.loading')} />
      </div>
    );
  }

  if (!isTechnician) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <BecomePartnerGate />
      </div>
    );
  }

  const activeKey = activeTabKey(location.pathname);

  return (
    <MobileAppShell
      title={t('nav.partner')}
      tabs={[
        { key: 'home', label: t('partner.nav.home'), href: '/partner', icon: Home },
        { key: 'jobs', label: t('partner.nav.jobs'), href: '/partner/jobs', icon: Briefcase },
        {
          key: 'earnings',
          label: t('partner.nav.earnings'),
          href: '/partner/earnings',
          icon: Wallet,
        },
        { key: 'trust', label: t('partner.nav.trust'), href: '/partner/trust', icon: ShieldCheck },
        {
          key: 'slots',
          label: t('partner.nav.slots'),
          href: '/partner/slots',
          icon: CalendarClock,
        },
      ]}
      activeKey={activeKey}
    >
      <Routes>
        <Route index element={<PartnerHome />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="verification" element={<Verification />} />
        <Route path="jobs" element={<JobsInbox />} />
        <Route path="jobs/history" element={<JobHistory />} />
        <Route path="jobs/:bookingId" element={<JobDetail />} />
        <Route path="earnings" element={<Earnings />} />
        <Route path="trust" element={<Trust />} />
        <Route path="slots" element={<Slots />} />
        <Route path="notifications" element={<Notifications />} />
        <Route
          path="*"
          element={
            <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
              <Card title={t('nav.partner')}>
                <p className="text-sm text-muted">{t('notFound.title')}</p>
              </Card>
            </div>
          }
        />
      </Routes>
    </MobileAppShell>
  );
}

/**
 * Which bottom tab lights up for a given pathname. Onboarding, verification
 * and notifications all read as the home tab rather than introducing an
 * unmapped tab for a screen that is one step away from home either way.
 * `useLocation().pathname` carries the real `/en` prefix on the English tree
 * (`router/localePrefix.ts` mounts the same route tree twice, once per
 * locale — it is not stripped before this component renders), so it is
 * stripped here the same way `i18n/useT.ts`'s `useLocale()` detects it.
 */
function activeTabKey(pathname: string): string {
  const path = pathname.replace(/^\/en(?=\/|$)/, '');

  if (path.startsWith('/partner/jobs')) return 'jobs';
  if (path.startsWith('/partner/earnings')) return 'earnings';
  if (path.startsWith('/partner/trust')) return 'trust';
  if (path.startsWith('/partner/slots')) return 'slots';
  return 'home';
}
