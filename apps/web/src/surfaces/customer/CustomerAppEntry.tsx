import { Home, ListChecks, Bell, User } from 'lucide-react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { useAuth } from '../../lib/auth/useAuth';
import { ShopShell, type ShopNavItem } from '../../components/shell/ShopShell';
import { LocaleToggle } from '../../components/shell/LocaleToggle';
import { Button, Card } from '../../components/ui';
import { useUnreadCount } from './data/notifications';
import HomePage from './pages/Home';
import SearchPage from './pages/Search';
import ProviderProfilePage from './pages/ProviderProfile';
import BookingsPage from './pages/Bookings';
import BookingDetailPage from './pages/BookingDetail';
import BookingComplaintPage from './pages/BookingComplaint';
import AddressesPage from './pages/Addresses';
import NotificationsPage from './pages/Notifications';
import ComplaintsPage from './pages/Complaints';
import AccountPage from './pages/Account';

/**
 * `/app/*` — the customer surface. Mounted (lazily) by `router/router.tsx`
 * behind `RequireAuth`, once per locale prefix (see `router/localePrefix.ts`)
 * — this component itself is written locale-unprefixed, same as every route
 * in `router.tsx`. Nested routing here (a `<Routes>` inside the entry, per
 * the foundation README's "either is fine") rather than flattening into
 * `router.tsx`'s top-level table, so this surface's own route tree stays a
 * self-contained unit another agent does not have to touch.
 *
 * `activeKey` is derived from the pathname rather than tracked in state —
 * the bottom tab bar has to reflect the URL on a direct link/reload/back
 * button, not just a tap on itself.
 */
export default function CustomerAppEntry() {
  const t = useT();
  const location = useLocation();
  const { data: unreadData } = useUnreadCount();

  // Strip an optional `/en` locale prefix before matching, so this works
  // identically under both mounts of the route tree.
  const path = location.pathname.replace(/^\/en(?=\/|$)/, '');

  const activeKey = path.startsWith('/app/bookings')
    ? 'bookings'
    : path.startsWith('/app/notifications')
      ? 'notifications'
      : path.startsWith('/app/account') ||
          path.startsWith('/app/addresses') ||
          path.startsWith('/app/complaints')
        ? 'account'
        : 'home';

  const locale = useLocale();
  const { logout } = useAuth();
  const href = (path: string): string => buildLocalizedHref(locale, path);

  const items: ShopNavItem[] = [
    { key: 'home', label: t('app.nav.find'), href: href('/app'), icon: Home },
    {
      key: 'bookings',
      label: t('app.nav.bookings'),
      href: href('/app/bookings'),
      icon: ListChecks,
    },
    {
      key: 'notifications',
      label: t('app.nav.notifications'),
      href: href('/app/notifications'),
      icon: Bell,
      badge: unreadData?.unread ?? 0,
    },
    { key: 'account', label: t('app.nav.account'), href: href('/app/account'), icon: User },
  ];

  return (
    <ShopShell
      navLabel={t('nav.app')}
      items={items}
      activeKey={activeKey}
      homeHref={href('/app')}
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
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="providers/:providerId" element={<ProviderProfilePage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route path="bookings/:bookingId" element={<BookingDetailPage />} />
        <Route path="bookings/:bookingId/complaint" element={<BookingComplaintPage />} />
        <Route path="addresses" element={<AddressesPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route
          path="*"
          element={
            <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
              <Card title={t('nav.app')}>
                <p className="text-sm text-muted">{t('notFound.title')}</p>
              </Card>
            </div>
          }
        />
      </Routes>
    </ShopShell>
  );
}
