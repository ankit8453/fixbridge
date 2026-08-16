import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List filters live in the URL, not in component state.
 *
 * Two reasons, both practical. The overview's tiles link straight to a filtered
 * list (`/providers?suspended=true`) — that only works if a filter is a URL. And
 * an ops user who finds something worth a second opinion needs to be able to
 * paste the address into a chat window and have a colleague see the same rows.
 */
export interface FilterState {
  get: (name: string) => string | undefined;
  set: (name: string, value: string | undefined) => void;
  page: number;
  setPage: (page: number) => void;
}

/**
 * `pageKey` exists because one route can hold two independent lists — the money
 * screen paginates payout batches and ledger journals side by side. Sharing a
 * single `page` parameter between them would make paging one silently jump the
 * other, which is the kind of bug nobody reports and everybody works around.
 */
export function useFilters(pageKey = 'page'): FilterState {
  const [params, setParams] = useSearchParams();

  const set = useCallback(
    (name: string, value: string | undefined) => {
      const next = new URLSearchParams(params);

      if (!value) next.delete(name);
      else next.set(name, value);

      // Changing a filter always returns to page one. Landing on page 4 of a
      // result set that now has two rows looks exactly like an empty queue.
      if (name !== pageKey) next.delete(pageKey);

      setParams(next, { replace: true });
    },
    [params, setParams, pageKey],
  );

  const raw = Number(params.get(pageKey) ?? '1');

  return {
    get: (name) => params.get(name) ?? undefined,
    set,
    page: Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1,
    setPage: (page) => set(pageKey, String(page)),
  };
}
