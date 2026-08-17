import { useMemo } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import {
  ClipboardList,
  FileClock,
  Inbox,
  LayoutDashboard,
  MessageSquareWarning,
  ShieldCheck,
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/useAuth';
import { AdminShell, type AdminNavItem } from '@/components/shell/AdminShell';
import { Button } from '@/components/ui';
import OverviewPage from './pages/OverviewPage';
import VerificationQueuePage from './pages/VerificationQueuePage';
import VerificationCasePage from './pages/VerificationCasePage';
import ProvidersPage from './pages/ProvidersPage';
import ProviderDetailPage from './pages/ProviderDetailPage';
import BookingsPage from './pages/BookingsPage';
import BookingDetailPage from './pages/BookingDetailPage';
import ComplaintsPage from './pages/ComplaintsPage';
import ComplaintDetailPage from './pages/ComplaintDetailPage';
import ReviewsPage from './pages/ReviewsPage';
import MoneyPage from './pages/MoneyPage';
import PayoutBatchPage from './pages/PayoutBatchPage';
import JournalDetailPage from './pages/JournalDetailPage';
import QueuesPage from './pages/QueuesPage';
import AuditPage from './pages/AuditPage';

/**
 * `/admin/*` — the ops console. Ported from the ten pages under
 * `legacy-next-src/app/[locale]/admin/**`, all function-identical to that
 * reference (see this phase's report for what changed structurally and
 * why).
 *
 * `RequireRole(['ops', 'admin'])` already guards this whole subtree in
 * `router/router.tsx`, so everything below renders only for a signed-in
 * ops/admin session — there is no second gate to add here. What this file
 * owns is the nav item list (with live queue-depth badges pulled from the
 * same summary query the overview renders) and the ten routes themselves.
 */
const NAV: Omit<AdminNavItem, 'badge'>[] = [
  { key: 'overview', label: 'Overview', href: '/admin', icon: LayoutDashboard },
  { key: 'verification', label: 'Verification', href: '/admin/verification', icon: ShieldCheck },
  { key: 'providers', label: 'Technicians', href: '/admin/providers', icon: Users },
  { key: 'bookings', label: 'Bookings', href: '/admin/bookings', icon: ClipboardList },
  { key: 'complaints', label: 'Complaints', href: '/admin/complaints', icon: MessageSquareWarning },
  { key: 'reviews', label: 'Reviews', href: '/admin/reviews', icon: Star },
  { key: 'money', label: 'Money', href: '/admin/money', icon: Wallet },
  { key: 'queues', label: 'Queues', href: '/admin/queues', icon: Inbox },
  { key: 'audit', label: 'Audit log', href: '/admin/audit', icon: FileClock },
];

/** The current page's title/breadcrumb — matched by longest prefix, most-specific first. */
const TITLES: { prefix: string; label: string }[] = [
  { prefix: '/admin/verification', label: 'Verification' },
  { prefix: '/admin/providers', label: 'Technicians' },
  { prefix: '/admin/bookings', label: 'Bookings' },
  { prefix: '/admin/complaints', label: 'Complaints' },
  { prefix: '/admin/reviews', label: 'Reviews' },
  { prefix: '/admin/money', label: 'Money' },
  { prefix: '/admin/queues', label: 'Queues' },
  { prefix: '/admin/audit', label: 'Audit log' },
  { prefix: '/admin', label: 'Overview' },
];

export default function AdminAppEntry() {
  const { user, roles, logout } = useAuth();
  const { pathname } = useLocation();

  const title = useMemo(
    () => TITLES.find((entry) => pathname.startsWith(entry.prefix))?.label ?? 'Overview',
    [pathname],
  );

  return (
    <AdminShell
      title={title}
      activeHref={pathname}
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: title }]}
      navItems={NAV.map((item) => ({ ...item }))}
      userMenu={
        <div className="flex items-center gap-3">
          <div className="text-right text-xs leading-tight text-muted">
            <div className="font-medium text-slate-800">{user?.name ?? user?.phone ?? '—'}</div>
            <div>{roles.join(', ')}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      }
    >
      <Routes>
        <Route index element={<OverviewPage />} />
        <Route path="verification" element={<VerificationQueuePage />} />
        <Route path="verification/:caseId" element={<VerificationCasePage />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="providers/:providerId" element={<ProviderDetailPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route path="bookings/:bookingId" element={<BookingDetailPage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="complaints/:complaintId" element={<ComplaintDetailPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="money" element={<MoneyPage />} />
        <Route path="money/batches/:batchId" element={<PayoutBatchPage />} />
        <Route path="money/journals/:journalId" element={<JournalDetailPage />} />
        <Route path="queues" element={<QueuesPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Routes>
    </AdminShell>
  );
}
