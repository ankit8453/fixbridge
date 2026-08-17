'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useUnreadCount } from '@/components/customer/data/notifications';

interface Tab {
  key: string;
  path: string;
  labelKey: string;
  icon: string;
}

const TABS: readonly Tab[] = [
  { key: 'find', path: '/app', labelKey: 'app.nav.find', icon: '🔎' },
  { key: 'bookings', path: '/app/bookings', labelKey: 'app.nav.bookings', icon: '🧾' },
  {
    key: 'notifications',
    path: '/app/notifications',
    labelKey: 'app.nav.notifications',
    icon: '🔔',
  },
  { key: 'account', path: '/app/account', labelKey: 'app.nav.account', icon: '👤' },
];

/**
 * A fixed bottom tab bar, not a second top row.
 *
 * `RoleNav` (foundation, rendered above `{children}` by
 * `[locale]/app/layout.tsx`) already spends the top of the screen on the
 * brand mark, surface switcher and locale toggle — the things that change
 * rarely. Day-to-day navigation for a one-handed phone user belongs at the
 * thumb, at the bottom, which is why this is a second, fixed bar rather than
 * more top-bar links. `main` in the layout gets bottom padding sized to this
 * bar's height so the last card in any scrollable list is never hidden under
 * it (see `layout.tsx`).
 */
export function CustomerTabBar() {
  const t = useT();
  const locale = useLocale();
  const pathname = usePathname() || '/';
  const { data } = useUnreadCount();
  const unread = data?.unread ?? 0;

  return (
    <nav
      aria-label={t('app.nav.label')}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((tab) => {
        const href = buildLocalizedHref(locale, tab.path);
        const active = tab.path === '/app' ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-medium ${
              active ? 'text-brand' : 'text-slate-500'
            }`}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {tab.icon}
            </span>
            <span>{t(tab.labelKey)}</span>
            {tab.key === 'notifications' && unread > 0 ? (
              <span
                aria-label={t('app.nav.unreadCount', { count: unread })}
                className="absolute right-[22%] top-0.5 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
