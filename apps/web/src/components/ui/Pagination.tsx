'use client';

import { useT } from '../../i18n/useT';
import { Button } from './Button';

/**
 * Every paginated list in this app goes through this, including short ones —
 * a list that renders every row is fine until the week it isn't, and that
 * week is exactly the wrong time for the app to start loading slowly.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <span className="tabular-nums">
        {first}–{last} / {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label={t('pagination.previous')}
        >
          {t('pagination.previous')}
        </Button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label={t('pagination.next')}
        >
          {t('pagination.next')}
        </Button>
      </div>
    </div>
  );
}
