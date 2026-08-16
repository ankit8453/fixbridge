import { type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { Button } from './Button';

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {/* Never a bare spinner. "Loading…" tells nobody what is late, and a slow
          screen with no subject is indistinguishable from a broken one. */}
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded border border-dashed border-slate-300 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * The error state, with the request id.
 *
 * The API stamps `X-Request-Id` on every response and puts it in the error
 * envelope precisely so a failure can be traced to a server log. Printing it
 * here is the difference between an ops user filing "the payouts page broke" and
 * filing something an engineer can act on in one grep.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;
  const message = api?.message ?? (error instanceof Error ? error.message : 'Something failed.');

  return (
    <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-medium text-red-900">{message}</p>
      <dl className="mt-2 space-y-0.5 text-xs text-red-800">
        {api ? (
          <div>
            <span className="font-medium">Code:</span> <code>{api.code}</code>
            {api.status ? <span> (HTTP {api.status})</span> : null}
          </div>
        ) : null}
        {api?.requestId ? (
          <div>
            <span className="font-medium">Request id:</span> <code>{api.requestId}</code> — quote
            this when reporting it.
          </div>
        ) : null}
      </dl>
      {api?.fieldErrors.length ? (
        <ul className="mt-2 list-inside list-disc text-xs text-red-800">
          {api.fieldErrors.map((detail, index) => (
            <li key={`${detail.field ?? index}`}>
              <strong>{detail.field}</strong>: {detail.message}
            </li>
          ))}
        </ul>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Loading, error and empty for one query, in one place.
 *
 * Every query in this console goes through this. The alternative — each screen
 * choosing whether to bother — is how a console ends up with three screens that
 * render a blank table when the API is down.
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
  loadingLabel: string;
  empty?: { title: string; hint?: string };
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
