'use client';

import { type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { useT } from '../../i18n/useT';
import { Button } from './Button';

export function Spinner({ label }: { label?: string }) {
  const t = useT();

  return (
    <div role="status" className="flex items-center gap-2 py-6 text-base text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {/* Never a bare spinner — "loading" with no subject reads identically to
          a broken screen, and on a slow connection every load is candidate. */}
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title?: string; hint?: string }) {
  const t = useT();

  return (
    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
      <p className="text-base font-medium text-slate-700">{title ?? t('common.emptyGeneric')}</p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * The error state, with the request id.
 *
 * The API stamps `X-Request-Id` on every response and puts it in the error
 * envelope precisely so a failure can be traced to a server log — printing it
 * here is the difference between a support message that says "booking broke"
 * and one an engineer can act on with a single grep. Same reasoning as
 * admin's `ErrorState`.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const api = error instanceof ApiError ? error : null;
  const message =
    api?.message ?? (error instanceof Error ? error.message : t('common.errorGeneric'));

  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-base font-medium text-red-900">{message}</p>
      {api?.requestId ? (
        <p className="mt-2 text-sm text-red-800">
          {t('common.errorRequestId')}: <code>{api.requestId}</code>
        </p>
      ) : null}
      {api?.fieldErrors.length ? (
        <ul className="mt-2 list-inside list-disc text-sm text-red-800">
          {api.fieldErrors.map((detail, index) => (
            <li key={`${detail.field ?? index}`}>
              {detail.field ? <strong>{detail.field}: </strong> : null}
              {detail.message}
            </li>
          ))}
        </ul>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Loading, error and empty for one query, in one place — every data-bearing
 * screen in this app should route its TanStack Query result through this
 * rather than hand-rolling the three states again.
 */
export function QueryState<T>({
  status,
  error,
  data,
  loadingLabel,
  empty,
  isEmpty,
  onRetry,
  children,
}: {
  status: 'pending' | 'error' | 'success';
  error: unknown;
  data: T | undefined;
  loadingLabel?: string;
  empty?: { title?: string; hint?: string };
  isEmpty?: (data: T) => boolean;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (status === 'pending') return <Spinner label={loadingLabel} />;
  if (status === 'error' || data === undefined)
    return <ErrorState error={error} onRetry={onRetry} />;

  if (empty && isEmpty?.(data)) return <EmptyState title={empty.title} hint={empty.hint} />;

  return <>{children(data)}</>;
}
