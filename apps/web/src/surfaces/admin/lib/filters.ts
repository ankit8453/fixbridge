import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List filters live in the URL, not in component state. Ported from
 * `legacy-next-src/components/admin/lib/filters.ts`, rebuilt on react-router's
 * `useSearchParams` instead of Next's navigation hooks — the reasons for the
 * URL-as-state design are unchanged: the overview's tiles link straight to a
 * filtered list (`/admin/providers?suspended=true`), and an ops user who
 * finds something worth a second opinion needs to be able to paste the
 * address into a chat window and have a colleague see the same rows.
 *
 * `setSearchParams(..., { replace: true })`: changing a filter is not a page
 * the back button should have to unwind one keystroke at a time.
 */
export interface FilterState {
  get: (name: string) => string | undefined;
  set: (name: string, value: string | undefined) => void;
  page: number;
  setPage: (page: number) => void;
}

/**
 * `pageKey` exists because one route can hold two independent lists — the
 * money screen paginates payout batches and ledger journals side by side.
 * Sharing a single `page` parameter between them would make paging one
 * silently jump the other, which is the kind of bug nobody reports and
 * everybody works around.
 */
export function useFilters(pageKey = 'page'): FilterState {
  const [searchParams, setSearchParams] = useSearchParams();

  const set = useCallback(
    (name: string, value: string | undefined) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);

          if (!value) next.delete(name);
          else next.set(name, value);

          // Changing a filter always returns to page one. Landing on page 4
          // of a result set that now has two rows looks exactly like an
          // empty queue.
          if (name !== pageKey) next.delete(pageKey);

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, pageKey],
  );

  const raw = Number(searchParams.get(pageKey) ?? '1');

  return {
    get: (name) => searchParams.get(name) ?? undefined,
    set,
    page: Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1,
    setPage: (page) => set(pageKey, String(page)),
  };
}
