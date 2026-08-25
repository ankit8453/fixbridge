import { useQuery } from '@tanstack/react-query';
import { Route, Routes, useLocation } from 'react-router-dom';
import {
  Home,
  Briefcase,
  Wallet,
  ShieldCheck,
  CalendarClock,
  BadgeCheck,
  Bell,
  History,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../../lib/auth/useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { AppShell, type NavItem } from '../../components/shell/AppShell';
import { LocaleToggle } from '../../components/shell/LocaleToggle';
import { Button, Spinner } from '../../components/ui';
import { BecomePartnerGate } from './components/BecomePartnerGate';
import { EmptyState } from './components/ui';
import { fetchNotifications } from './lib/api';
import { partnerKeys } from './lib/query-keys';
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
 * `/partner/*` — the partner (technician) surface.
 *
 * Gated with `RequireAuth` in `router.tsx`, not `RequireRole('technician')`: a
 * signed-in customer with no provider registration must still reach `/partner`
 * and see the "become a partner" pitch. That branch lives here rather than in
 * the route guard because whether the user holds `technician` is only knowable
 * once the access token is in memory (`useAuth().roles`) — the router-level
 * guard only proves *someone* is signed in.
 *
 * ## Navigation
 *
 * `AppShell` renders a sidebar from `lg` up and a bottom tab bar below it. The
 * five `secondary` items appear in the sidebar and the mobile drawer but not
 * in the tab bar, which keeps the thumb targets big while still making every
 * page reachable — before this, five of the ten pages had no navigation at all
 * on a phone and were only findable by tile or deep link.
 */
export default function PartnerAppEntry() {
  const { status, roles, logout } = useAuth();
  const t = useT();
  const locale = useLocale();
  const location = useLocation();
  const isTechnician = roles.includes('technician');

  /**
   * The unread badge. Enabled only for technicians, because the gate below
   * renders for everybody else and this endpoint would 403 for them.
   *
   * `refetchOnWindowFocus` is the app default (off), so this is a per-mount
   * read rather than a poll — a technician who backgrounds the app on a job
   * should not be spending mobile data on a counter.
   */
  const unreadQuery = useQuery({
    queryKey: partnerKeys.notifications(1, true),
    queryFn: () => fetchNotifications(1, true),
    enabled: isTechnician,
  });
  const unread = unreadQuery.data?.unread ?? 0;

  if (status === 'restoring') {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
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

  const href = (path: string): string => buildLocalizedHref(locale, path);

  const items: NavItem[] = [
    { key: 'home', label: t('partner.nav.home'), href: href('/partner'), icon: Home },
    { key: 'jobs', label: t('partner.nav.jobs'), href: href('/partner/jobs'), icon: Briefcase },
    {
      key: 'earnings',
      label: t('partner.nav.earnings'),
      href: href('/partner/earnings'),
      icon: Wallet,
    },
    {
      key: 'trust',
      label: t('partner.nav.trust'),
      href: href('/partner/trust'),
      icon: ShieldCheck,
    },
    {
      key: 'slots',
      label: t('partner.nav.slots'),
      href: href('/partner/slots'),
      icon: CalendarClock,
    },
    // Reachable from the sidebar and the drawer, not the tab bar.
    {
      key: 'history',
      label: t('partner.nav.history'),
      href: href('/partner/jobs/history'),
      icon: History,
      secondary: true,
    },
    {
      key: 'verification',
      label: t('partner.nav.verification'),
      href: href('/partner/verification'),
      icon: BadgeCheck,
      secondary: true,
    },
    {
      key: 'notifications',
      label: t('partner.nav.notifications'),
      href: href('/partner/notifications'),
      icon: Bell,
      badge: unread,
      secondary: true,
    },
    {
      key: 'profile',
      label: t('partner.nav.profile'),
      href: href('/partner/onboarding'),
      icon: UserCog,
      secondary: true,
    },
  ];

  return (
    <AppShell
      title={titleFor(location.pathname, t)}
      navLabel={t('nav.partner')}
      items={items}
      activeKey={activeKey(location.pathname)}
      topBarActions={
        <>
          <LocaleToggle />
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            {t('nav.logout')}
          </Button>
        </>
      }
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
          element={<EmptyState title={t('notFound.title')} description={t('notFound.body')} />}
        />
      </Routes>
    </AppShell>
  );
}

/**
 * `useLocation().pathname` carries the real `/en` prefix on the English tree
 * (`router/localePrefix.ts` mounts the same tree twice, once per locale), so
 * it is stripped the same way `i18n/useT.ts`'s `useLocale()` detects it.
 */
function bare(pathname: string): string {
  return pathname.replace(/^\/en(?=\/|$)/, '');
}

/** Which nav entry is highlighted. */
function activeKey(pathname: string): string {
  const path = bare(pathname);

  // Before `/partner/jobs`, which would otherwise swallow it.
  if (path.startsWith('/partner/jobs/history')) return 'history';
  if (path.startsWith('/partner/jobs')) return 'jobs';
  if (path.startsWith('/partner/earnings')) return 'earnings';
  if (path.startsWith('/partner/trust')) return 'trust';
  if (path.startsWith('/partner/slots')) return 'slots';
  if (path.startsWith('/partner/verification')) return 'verification';
  if (path.startsWith('/partner/notifications')) return 'notifications';
  if (path.startsWith('/partner/onboarding')) return 'profile';
  return 'home';
}

/**
 * The top-bar heading.
 *
 * Every screen said "Partner" before, which wastes the one piece of persistent
 * chrome on a phone. Naming the current page is what makes the back-button
 * story legible.
 */
function titleFor(pathname: string, t: (key: string) => string): string {
  const path = bare(pathname);

  if (path.startsWith('/partner/jobs/history')) return t('partner.nav.history');
  if (path.startsWith('/partner/jobs/')) return t('partner.job.title');
  if (path.startsWith('/partner/jobs')) return t('partner.nav.jobs');
  if (path.startsWith('/partner/earnings')) return t('partner.nav.earnings');
  if (path.startsWith('/partner/trust')) return t('partner.nav.trust');
  if (path.startsWith('/partner/slots')) return t('partner.nav.slots');
  if (path.startsWith('/partner/verification')) return t('partner.nav.verification');
  if (path.startsWith('/partner/notifications')) return t('partner.nav.notifications');
  if (path.startsWith('/partner/onboarding')) return t('partner.nav.profile');
  return t('partner.home.title');
}
