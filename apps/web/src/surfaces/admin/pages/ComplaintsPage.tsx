import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, Inbox, ShieldAlert } from 'lucide-react';
import { fetchComplaints } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { Complaint } from '../lib/types';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import { Card, EmptyState, Pill, SectionHeader, SkeletonRows } from '../components/ui';
import { ErrorState, Field, Pagination, Select, Table, type TableColumn } from '@/components/ui';

const STATUSES = ['open', 'in_review', 'resolved', 'dismissed'];

/**
 * How this page's complaints break down by category, as a bar per category.
 *
 * Only ever describes the page in front of the reader, never the whole
 * table — the API paginates and returns no aggregate, so labelling this as
 * anything wider would be a lie the reader cannot check. It earns its place
 * because "three of the six on this page are safety" is the thing that
 * decides which row to open first, and counting badges by eye does not
 * scale past a screenful.
 */
function CategoryBars({ complaints }: { complaints: Complaint[] }) {
  const counts = new Map<string, number>();
  for (const complaint of complaints) {
    counts.set(complaint.category, (counts.get(complaint.category) ?? 0) + 1);
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length < 2) return null;

  const peak = Math.max(...rows.map(([, count]) => count), 1);

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      {rows.map(([category, count]) => (
        <div key={category} className="min-w-[7rem] flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {category}
            </span>
            <span className="text-xs font-semibold tabular-nums text-slate-900">{count}</span>
          </div>
          {/* Decorative: the count it scales is printed immediately above. */}
          <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className={category === 'safety' ? 'h-full bg-danger' : 'h-full bg-admin'}
              style={{ width: `${(count / peak) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ported from `legacy-next-src/app/[locale]/admin/complaints/page.tsx`. */
export default function ComplaintsPage() {
  const filters = useFilters();
  const status = filters.get('status');

  const query = useQuery({
    queryKey: ['admin', 'complaints', { status, page: filters.page }],
    queryFn: () => fetchComplaints({ status, page: filters.page }),
  });

  const columns: TableColumn<Complaint>[] = [
    { key: 'raised', header: 'Raised', render: (row) => <Timestamp value={row.createdAt} /> },
    {
      key: 'category',
      header: 'Category',
      render: (row) =>
        // Safety is the one category that has already acted on somebody —
        // it suspends the technician the moment it is filed — so it is the
        // one that gets colour in a list of otherwise equal words.
        row.category === 'safety' ? (
          <Pill tone="danger">safety</Pill>
        ) : (
          <span className="text-slate-600">{row.category}</span>
        ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'severity',
      header: 'Severity',
      render: (row) =>
        row.severity ? (
          <Pill tone={row.severity === 'severe' ? 'danger' : 'warning'}>{row.severity}</Pill>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <span className="block max-w-md truncate text-slate-700">{row.description}</span>
      ),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      render: (row) => (
        <Link
          className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-admin hover:underline"
          to={`/admin/complaints/${row.id}`}
        >
          Open
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Complaints"
        description="Oldest first. A safety complaint from a customer has already suspended the technician — your decision either stands it up or lifts it."
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 bg-slate-50/60 p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <ShieldAlert className="h-4 w-4 text-slate-400" aria-hidden="true" strokeWidth={1.75} />
            Queue
          </div>
          <div className="w-full sm:w-56">
            <Field label="Status">
              {(id) => (
                <Select
                  id={id}
                  value={status ?? ''}
                  onChange={(event) => filters.set('status', event.target.value || undefined)}
                >
                  <option value="">All</option>
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>

        {query.status === 'pending' ? (
          <SkeletonRows rows={6} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing in the queue."
            description="No complaint matches this filter."
          />
        ) : (
          <>
            <CategoryBars complaints={query.data.items} />
            <div className="p-3">
              <Table columns={columns} rows={query.data.items} rowKey={(row) => row.id} />
              <div className="mt-3">
                <Pagination
                  page={query.data.page}
                  pageSize={query.data.pageSize}
                  total={query.data.total}
                  onChange={filters.setPage}
                />
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
