import { type ReactNode } from 'react';
import { EmptyState } from './States';

/**
 * A data-driven, responsive table. Below `sm:` (~640px — a phone in
 * portrait) the `<table>` gives way to one card per row, because a table
 * with more than two or three columns just does not fit a phone screen
 * without horizontal scrolling turning every read into a guessing game.
 * Above `sm:` it is a real `<table>` with a sticky header and right-aligned
 * numeric columns, for the surfaces (mostly `/admin`) where the audience
 * really is at a desk.
 */
export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  /** Omit this column from the mobile card view — e.g. an id already shown as the card's title. */
  hideOnMobile?: boolean;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  empty,
  cardTitle,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: { title?: string; hint?: string };
  /** What headlines each mobile card — defaults to the first column's value. */
  cardTitle?: (row: T) => ReactNode;
}) {
  if (rows.length === 0) return <EmptyState title={empty?.title} hint={empty?.hint} />;

  return (
    <>
      {/* Desktop/tablet: a real table, scrolling sideways inside its own box
          rather than the page — a wide admin table must never make the whole
          page scroll horizontally. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-2 font-medium ${column.align === 'right' ? 'text-right' : ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-slate-50">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 align-top tabular-nums text-slate-800 ${column.align === 'right' ? 'text-right' : ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per row, label/value pairs for every column except
          whichever one is already the card's own title. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            className="rounded-xl border border-border bg-surface p-3 shadow-card"
          >
            <div className="mb-1 font-medium text-slate-900">
              {cardTitle ? cardTitle(row) : columns[0]?.render(row)}
            </div>
            <dl className="flex flex-col gap-1 text-sm">
              {columns
                .filter((column) => !column.hideOnMobile && column !== columns[0])
                .map((column) => (
                  <div key={column.key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">{column.header}</dt>
                    <dd className="tabular-nums text-slate-900">{column.render(row)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
