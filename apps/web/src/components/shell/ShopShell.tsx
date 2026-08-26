import { type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideProps } from 'lucide-react';
import { APP_NAME, BrandLogo } from '../../brand/tokens';

/**
 * The customer storefront's shell — a top bar, no sidebar.
 *
 * ## Why this is not `AppShell`
 *
 * The customer app was mounted on the partner app's shell and came out looking
 * like the same product with different words. It is not the same product. A
 * sidebar is dashboard furniture: it belongs to somebody working a queue, and
 * it is what makes an app read as a tool. Customers browse and book — the same
 * gesture as shopping — so the desktop layout is a wide top bar over
 * full-width content, and the phone layout keeps a bottom tab bar because a
 * thumb cannot reach the top of a phone.
 *
 * Colour comes from the `shop-*` tokens (deep plum), never the
 * `brand-*` indigo the partner surface uses — see `shopColors` in
 * `brand/tokens.ts`.
 */
export interface ShopNavItem {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<LucideProps>;
  /** Unread count — a dot on the tab icon, a pill in the top bar. */
  badge?: number;
}

export function ShopShell({
  navLabel,
  items,
  activeKey,
  homeHref,
  topBarActions,
  children,
}: {
  /** Accessible name for the nav landmarks. */
  navLabel: string;
  items: ShopNavItem[];
  activeKey: string;
  /** Where the wordmark links to. */
  homeHref: string;
  topBarActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-shop-ground">
      {/* ---------------- Top bar ---------------- */}
      <header className="sticky top-0 z-30 border-b border-shop-line bg-shop-ground/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 lg:h-16 lg:px-6">
          <Link to={homeHref} className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-shop-bright to-shop-accent shadow-sm">
              <BrandLogo size={17} />
            </span>
            <span className="text-[15px] font-bold tracking-tight text-shop-ink">{APP_NAME}</span>
          </Link>

          {/* Desktop nav. Hidden on a phone, where the bottom bar carries it. */}
          <nav aria-label={navLabel} className="ml-4 hidden flex-1 items-center gap-1 lg:flex">
            {items.map((item) => {
              const active = item.key === activeKey;
              return (
                <Link
                  key={item.key}
                  to={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'relative rounded-full bg-shop-soft px-3.5 py-2 text-sm font-semibold text-shop transition-colors'
                      : 'relative rounded-full px-3.5 py-2 text-sm font-medium text-shop-ink-soft transition-colors hover:bg-shop-soft/60 hover:text-shop-ink'
                  }
                >
                  {item.label}
                  {item.badge ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-shop-bright px-1 text-[10px] font-bold leading-none text-white">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">{topBarActions}</div>
        </div>
      </header>

      {/* ---------------- Content ---------------- */}
      {/* `pb-24` clears the fixed tab bar on a phone; desktop has no bar, so
          the padding drops away with the breakpoint. */}
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 lg:px-6 lg:pb-8 lg:pt-5">
        {children}
      </main>

      {/* ---------------- Bottom tabs (phone only) ---------------- */}
      <nav
        aria-label={navLabel}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-shop-line bg-white lg:hidden"
        // Without this the last row sits under the iOS home indicator.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className="relative flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium"
            >
              <span className="relative">
                <Icon
                  className={active ? 'h-5 w-5 text-shop' : 'h-5 w-5 text-shop-ink-soft'}
                  aria-hidden="true"
                  strokeWidth={active ? 2.3 : 1.75}
                />
                {item.badge ? (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-shop-bright px-1 py-0.5 text-[10px] font-bold leading-none text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </span>
              <span className={active ? 'text-shop' : 'text-shop-ink-soft'}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
