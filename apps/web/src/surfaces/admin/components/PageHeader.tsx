import { type ReactNode } from 'react';

/**
 * The per-page title row inside `AdminShell`'s content area — a title,
 * optional subtitle and right-aligned actions. `AdminShell` itself already
 * renders the breadcrumb + page title in its topbar (see AdminAppEntry), so
 * this is deliberately smaller: a secondary heading for the content area
 * itself, matching the legacy console's `PageHeader` (which owned the whole
 * heading there, before this app had a shell with its own topbar).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
