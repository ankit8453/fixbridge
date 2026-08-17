import { type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideProps } from 'lucide-react';

/**
 * The customer/partner shell — a compact sticky top bar and a sticky bottom
 * tab bar, thumb-reachable on a one-handed phone grip. This is the shape
 * both `/app` and `/partner` share; what differs between them is only the
 * tab list each surface passes in.
 */
export interface MobileTabItem {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<LucideProps>;
  /** Unread count — the notifications tab's badge. */
  badge?: number;
}

export function MobileAppShell({
  title,
  topBarActions,
  tabs,
  activeKey,
  children,
}: {
  title?: ReactNode;
  topBarActions?: ReactNode;
  tabs: MobileTabItem[];
  activeKey: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="sticky top-0 z-30 flex min-h-touch items-center justify-between gap-2 border-b border-border bg-white px-4 py-2">
        <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
        {topBarActions ? (
          <div className="flex shrink-0 items-center gap-1">{topBarActions}</div>
        ) : null}
      </header>

      {/* Bottom padding reserves space for the fixed tab bar so the last bit
          of scrollable content is never hidden behind it. */}
      <main className="flex-1 pb-20">{children}</main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-white"
        // The iOS home-indicator safe area — without this, the tab bar's own
        // padding is not enough and the bottom row sits under the gesture bar.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              to={tab.href}
              aria-current={active ? 'page' : undefined}
              className="relative flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-medium"
            >
              <span className="relative">
                <Icon
                  className={`h-5 w-5 ${active ? 'text-brand' : 'text-slate-400'}`}
                  aria-hidden="true"
                  strokeWidth={active ? 2.25 : 1.75}
                />
                {tab.badge ? (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 py-0.5 text-[10px] font-semibold leading-none text-danger-foreground">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                ) : null}
              </span>
              <span className={active ? 'text-brand' : 'text-slate-500'}>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
