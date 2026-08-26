import { useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  type LucideProps,
} from 'lucide-react';
import { APP_NAME, BrandLogo } from '../../brand/tokens';

/**
 * The ops console shell — a light rail, a light canvas, teal accents.
 *
 * ## Why this looks nothing like the partner app
 *
 * Two audiences doing two different jobs. A technician is on a phone between
 * jobs, and the indigo brand is the product they chose to work for. An ops
 * reviewer is at a desk all day working a queue, deciding whether somebody
 * earns this week — that is an instrument panel, not a storefront.
 *
 * It also matters that the difference is *instant*. The two surfaces share a
 * browser and a session, and an ops user with both open should never have to
 * read the URL to know which one they are about to click in. The teal accent
 * and the denser layout settle that in peripheral vision.
 *
 * Colour comes from `adminColors` in `brand/tokens.ts` via the `admin-*`
 * Tailwind tokens, never a literal hex — a palette retune stays a one-file
 * change.
 *
 * Below `md:` the sidebar becomes an off-canvas drawer rather than vanishing,
 * so an ops user on a phone is inconvenienced rather than locked out.
 */
export interface AdminNavItem {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<LucideProps>;
  /** e.g. an open-cases count on the verification queue link. */
  badge?: number;
  /** Starts a new labelled group in the rail. */
  group?: string;
}

export interface Breadcrumb {
  label: string;
  href?: string;
}

export function AdminShell({
  navItems,
  activeHref,
  title,
  breadcrumbs,
  userMenu,
  children,
}: {
  navItems: AdminNavItem[];
  /** The current pathname — highlights the active item on an exact-or-prefix match. */
  activeHref: string;
  title: ReactNode;
  breadcrumbs?: Breadcrumb[];
  userMenu?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const renderNav = (isCollapsed: boolean, onNavigate?: () => void) => (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
      {navItems.map((item) => {
        const active = activeHref === item.href || activeHref.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <div key={item.key}>
            {item.group && !isCollapsed ? (
              <p className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {item.group}
              </p>
            ) : null}
            <Link
              to={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={isCollapsed ? item.label : undefined}
              className={
                active
                  ? 'group relative flex min-h-touch items-center gap-3 rounded-lg bg-admin-soft px-3 text-sm font-semibold text-admin-deep transition-colors'
                  : 'group relative flex min-h-touch items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900'
              }
            >
              {/* A teal bar as well as the tint: colour alone should not be the
                  only thing marking the current page. */}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-admin"
                />
              ) : null}
              <Icon
                className={
                  active
                    ? 'h-[18px] w-[18px] shrink-0 text-admin'
                    : 'h-[18px] w-[18px] shrink-0 text-slate-400 transition-colors group-hover:text-slate-600'
                }
                aria-hidden="true"
                strokeWidth={active ? 2.1 : 1.75}
              />
              {!isCollapsed ? <span className="truncate">{item.label}</span> : null}
              {!isCollapsed && item.badge ? (
                <span
                  className={
                    active
                      ? 'ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-admin px-1.5 py-0.5 text-[10px] font-bold leading-none text-admin-foreground'
                      : 'ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-700'
                  }
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </Link>
          </div>
        );
      })}
    </nav>
  );

  const brandBar = (isCollapsed: boolean) => (
    <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-slate-100 px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-admin to-admin-alt shadow-sm">
        <BrandLogo size={18} />
      </span>
      {!isCollapsed ? (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[13px] font-bold tracking-tight text-slate-900">
            {APP_NAME}
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.1em] text-admin">
            Ops console
          </span>
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-slate-100/70">
      {/* ---------------- Desktop rail ---------------- */}
      <aside
        aria-label="Console"
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {brandBar(collapsed)}
        {renderNav(collapsed)}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex min-h-touch items-center gap-3 border-t border-slate-100 px-5 py-3 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </aside>

      {/* ---------------- Mobile drawer ---------------- */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex h-dvh w-64 flex-col border-r border-slate-200 bg-white shadow-2xl">
            <div className="relative">
              {brandBar(false)}
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {renderNav(false, () => setDrawerOpen(false))}
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="flex-1 bg-slate-950/50 backdrop-blur-sm"
          />
        </div>
      ) : null}

      {/* ---------------- Content ---------------- */}
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-touch items-center gap-3 border-b border-slate-200 bg-white/85 px-4 py-2.5 backdrop-blur-md sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>

          <div className="min-w-0 flex-1">
            {breadcrumbs?.length ? (
              <nav
                aria-label="Breadcrumb"
                className="mb-0.5 flex items-center gap-1 text-[11px] text-slate-500"
              >
                {breadcrumbs.map((crumb, index) => (
                  <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                    {index > 0 ? (
                      <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" />
                    ) : null}
                    {crumb.href ? (
                      <Link to={crumb.href} className="transition-colors hover:text-admin">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-slate-600">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            ) : null}
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
          </div>

          {userMenu ? <div className="shrink-0">{userMenu}</div> : null}
        </header>

        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
