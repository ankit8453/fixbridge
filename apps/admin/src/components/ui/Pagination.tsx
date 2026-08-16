import { Button } from './Button';

/**
 * Every list in this console is paginated, including the ones that are short today.
 *
 * A queue that renders every row is fine until the week it is not, and the week
 * it is not is a week when something is already wrong — the worst possible time
 * for the console to stop loading.
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
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-1 pt-3 text-xs text-slate-600">
      <span className="tabular-nums">
        {first}–{last} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
