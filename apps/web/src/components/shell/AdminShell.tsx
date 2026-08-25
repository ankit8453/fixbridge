import { useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, type LucideProps } from 'lucide-react';
import { APP_NAME, BrandLogo } from '../../brand/tokens';

/**
 * The ops console shell — a dark slate sidebar, a sticky light topbar, and a
 * `bg-slate-50` content canvas holding white cards. This is deliberately the
 * one place in the app that does NOT read as mobile-first: the ops/admin
 * audience is at a desk, working a queue, and the brief asks for "a 2026
 * SaaS console", not a phone-adapted dashboard. Below `md:` the sidebar
 * becomes an off-canvas drawer rather than disappearing outright, so an ops
 * user is never fully locked out on a phone — just not who this shell is
 * designed for.
 *
 * A surface plugs in by rendering `<AdminShell navItems={...} activeHref={...}>`
 * around its routed content; this component owns no routing of its own.
 */
export interface AdminNavItem {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<LucideProps>;
  /** e.g. an open-cases count on the verification queue link. */
  badge?: number;
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
  /** The current pathname — used to highlight the active nav item; an exact-or-prefix match. */
  activeHref: string;
  title: ReactNode;
  breadcrumbs?: Breadcrumb[];
  userMenu?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {navItems.map((item) => {
        const active = activeHref === item.href || activeHref.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            to={item.href}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={`group flex min-h-touch items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-all duration-200 ${
              active
                ? 'bg-brand/10 text-brand shadow-sm'
                : 'text-slate-600 hover:bg-slate-100/60 hover:text-slate-900'
            }`}
          >
            <Icon
              className={`h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                active ? 'text-brand' : 'text-slate-400 group-hover:text-slate-600'
              }`}
              aria-hidden="true"
              strokeWidth={1.75}
            />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
            {!collapsed && item.badge ? (
              <span
                className={`ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  active ? 'bg-brand text-brand-foreground' : 'bg-slate-200/60 text-slate-700'
                }`}
              >
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-slate-50/60">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col bg-white border-r border-slate-200/60 shadow-[1px_0_8px_rgba(15,23,42,0.015)] transition-[width] duration-200 md:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="flex min-h-touch items-center gap-2 px-5 py-4 border-b border-slate-100">
          <BrandLogo size={28} />
          {!collapsed ? (
            <span className="truncate text-sm font-bold text-slate-800 tracking-tight">
              {APP_NAME}
            </span>
          ) : null}
        </div>
        {nav}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex min-h-touch items-center gap-3 border-t border-slate-100 px-5 py-4 text-sm font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <>
              <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.75} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </aside>

      {/* Mobile off-canvas drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex h-dvh w-64 flex-col bg-white border-r border-slate-200 shadow-xl">
            <div className="flex min-h-touch items-center gap-2 px-5 py-4 border-b border-slate-100">
              <BrandLogo size={28} />
              <span className="text-sm font-bold text-slate-800 tracking-tight">{APP_NAME}</span>
            </div>
            {nav}
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="flex-1 bg-slate-900/40 backdrop-blur-sm"
          />
        </div>
      ) : null}

      <div className="flex min-h-dvh flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-touch items-center gap-3 border-b border-border bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </button>

          <div className="min-w-0 flex-1">
            {breadcrumbs?.length ? (
              <nav
                aria-label="Breadcrumb"
                className="mb-0.5 flex items-center gap-1 text-xs text-muted"
              >
                {breadcrumbs.map((crumb, index) => (
                  <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                    {index > 0 ? <ChevronRight className="h-3 w-3" aria-hidden="true" /> : null}
                    {crumb.href ? (
                      <Link to={crumb.href} className="hover:text-slate-700 hover:underline">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            ) : null}
            <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
          </div>

          {userMenu ? <div className="shrink-0">{userMenu}</div> : null}
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
