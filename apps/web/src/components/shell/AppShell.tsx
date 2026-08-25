import { useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideProps } from 'lucide-react';
import { Menu, X } from 'lucide-react';
import { APP_NAME, BrandLogo } from '../../brand/tokens';

/**
 * One shell, two shapes: a sidebar on desktop, bottom tabs on a phone.
 *
 * `MobileAppShell` capped every screen at `max-w-md` and put navigation in a
 * fixed bottom bar. That is right for a technician holding a phone one-handed
 * on a job, and wrong for the same person doing their week's planning on a
 * laptop, where it rendered a 448px strip marooned in the middle of a 1440px
 * window.
 *
 * The fix is one component that changes shape at `lg`, not two codebases:
 *
 *   - **< 1024px** — sticky top bar, content, fixed bottom tab bar. Unchanged
 *     in shape from what shipped, because that was already right for a phone.
 *   - **>= 1024px** — a persistent left sidebar with the same destinations,
 *     the bottom bar hidden, and content free to use the width.
 *
 * The nav list is the same data in both. A destination cannot appear in one
 * and be forgotten in the other, which is exactly how the old surface ended up
 * with five bottom tabs and ten reachable pages.
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<LucideProps>;
  /** Unread count — a badge on the tab icon, a pill in the sidebar. */
  badge?: number;
  /**
   * Shown in the sidebar and the mobile drawer, but not in the bottom tab bar.
   *
   * Five tabs is about the most a thumb can hit reliably, but "not primary" is
   * not the same as "unreachable" — before this, the five non-tab pages had no
   * navigation at all on a phone.
   */
  secondary?: boolean;
}

export function AppShell({
  title,
  navLabel,
  items,
  activeKey,
  topBarActions,
  children,
}: {
  title?: ReactNode;
  /** Accessible name for the nav landmarks — differs per surface. */
  navLabel: string;
  items: NavItem[];
  activeKey: string;
  topBarActions?: ReactNode;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const primary = items.filter((item) => !item.secondary);

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside
        aria-label={navLabel}
        className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex"
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5">
          <BrandLogo size={30} />
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            {APP_NAME}
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((item) => (
            <SidebarLink key={item.key} item={item} active={item.key === activeKey} />
          ))}
        </nav>
      </aside>

      {/* ---------------- Mobile drawer ---------------- */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
              <span className="flex items-center gap-2.5">
                <BrandLogo size={28} />
                <span className="text-[15px] font-semibold text-slate-900">{APP_NAME}</span>
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex min-h-touch min-w-touch items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label={navLabel} className="flex-1 space-y-0.5 overflow-y-auto p-3">
              {items.map((item) => (
                <SidebarLink
                  key={item.key}
                  item={item}
                  active={item.key === activeKey}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </nav>
          </div>
        </div>
      ) : null}

      {/* ---------------- Content column ---------------- */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-sm lg:h-16 lg:px-8">
          {/* The drawer is the only route to `secondary` items on a phone,
              since they are deliberately absent from the bottom tab bar. */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 flex min-h-touch min-w-touch items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-slate-900 lg:text-lg">
            {title}
          </h1>

          {topBarActions ? (
            <div className="flex shrink-0 items-center gap-1.5">{topBarActions}</div>
          ) : null}
        </header>

        {/* `pb-24` clears the fixed tab bar on mobile; desktop has no bar to
            clear, so the padding drops away with the breakpoint. */}
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-6">
          {children}
        </main>
      </div>

      {/* ---------------- Mobile bottom tabs ---------------- */}
      <nav
        aria-label={navLabel}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white lg:hidden"
        // Without this the last row sits under the iOS home indicator.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {primary.map((item) => {
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
                  className={active ? 'h-5 w-5 text-brand' : 'h-5 w-5 text-slate-400'}
                  aria-hidden="true"
                  strokeWidth={active ? 2.25 : 1.75}
                />
                {item.badge ? (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 py-0.5 text-[10px] font-semibold leading-none text-danger-foreground">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </span>
              <span className={active ? 'text-brand' : 'text-slate-500'}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'flex min-h-touch items-center gap-3 rounded-lg bg-brand/10 px-3 py-2.5 text-sm font-medium text-brand transition-colors'
          : 'flex min-h-touch items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900'
      }
    >
      <Icon
        className={
          active
            ? 'h-[18px] w-[18px] shrink-0 text-brand'
            : 'h-[18px] w-[18px] shrink-0 text-slate-400'
        }
        aria-hidden="true"
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none text-danger-foreground">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
    </Link>
  );
}
