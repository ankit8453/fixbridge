'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * List filters live in the URL, not in component state.
 *
 * Ported from apps/admin/src/lib/filters.ts, rebuilt on Next's navigation
 * hooks instead of react-router's `useSearchParams` — the reasons for the
 * URL-as-state design are unchanged: the overview's tiles link straight to a
 * filtered list (`/admin/providers?suspended=true`), and an ops user who
 * finds something worth a second opinion needs to be able to paste the
 * address into a chat window and have a colleague see the same rows.
 *
 * `router.replace` (not `push`): changing a filter is not a page the back
 * button should have to unwind one keystroke at a time.
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const set = useCallback(
    (name: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString());

      if (!value) next.delete(name);
      else next.set(name, value);

      // Changing a filter always returns to page one. Landing on page 4 of a
      // result set that now has two rows looks exactly like an empty queue.
      if (name !== pageKey) next.delete(pageKey);

      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, pageKey],
  );

  const raw = Number(searchParams.get(pageKey) ?? '1');

  return {
    get: (name) => searchParams.get(name) ?? undefined,
    set,
    page: Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1,
    setPage: (page) => set(pageKey, String(page)),
  };
}
