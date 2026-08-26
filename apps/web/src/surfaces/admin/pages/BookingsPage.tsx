import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, Search } from 'lucide-react';
import { fetchBookings } from '../lib/api';
import { useFilters } from '../lib/filters';
import { dateInputToIso } from '../lib/time';
import type { BookingRow } from '../lib/types';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import { Card, EmptyState, SectionHeader, SkeletonRows } from '../components/ui';
import {
  ErrorState,
  Field,
  Pagination,
  Select,
  Table,
  TextInput,
  type TableColumn,
} from '@/components/ui';
import { formatPaise } from '@/lib/money';

/** The `booking_status` enum, verbatim. The API filters on an exact match. */
const STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'WORK_DONE',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'CLOSED_QUOTE_DECLINED',
];

/** Ported from `legacy-next-src/app/[locale]/admin/bookings/page.tsx`. */
export default function BookingsPage() {
  const filters = useFilters();

  const from = filters.get('from');
  const to = filters.get('to');

  const params = {
    q: filters.get('q'),
    status: filters.get('status'),
    from: dateInputToIso(from ?? '', 'start'),
    to: dateInputToIso(to ?? '', 'end'),
    page: filters.page,
  };

  const query = useQuery({
    queryKey: ['admin', 'bookings', params],
    queryFn: () => fetchBookings(params),
  });

  const columns: TableColumn<BookingRow>[] = [
    {
      key: 'id',
      header: 'Booking',
      render: (row) => (
        <Link
          className="font-mono text-xs font-semibold text-admin hover:underline"
          to={`/admin/bookings/${row.id}`}
        >
          {row.id.slice(0, 8)}…
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <>
          <span className="font-medium text-slate-900">{row.customer?.name ?? '—'}</span>
          <div className="text-xs tabular-nums text-slate-500">{row.customer?.phone}</div>
        </>
      ),
    },
    {
      key: 'provider',
      header: 'Technician',
      render: (row) =>
        row.provider ? (
          <Link
            className="font-medium text-admin hover:underline"
            to={`/admin/providers/${row.provider.userId}`}
          >
            {row.provider.displayName ?? row.provider.userId}
          </Link>
        ) : (
          <span className="text-slate-400">unassigned</span>
        ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => <span className="text-slate-600">{row.category?.nameKey ?? '—'}</span>,
    },
    { key: 'starts', header: 'Starts', render: (row) => <Timestamp value={row.startsAt} /> },
    {
      key: 'payable',
      header: 'Payable',
      align: 'right',
      render: (row) =>
        row.payablePaise === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className="font-semibold tabular-nums text-slate-900">
            {formatPaise(row.payablePaise)}
          </span>
        ),
    },
    { key: 'created', header: 'Created', render: (row) => <Timestamp value={row.createdAt} /> },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Bookings"
        description="One search box. Paste a booking id, or type the phone number the caller read out — either side of the job."
      />

      <Card padded={false}>
        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Booking id or phone">
            {(id) => (
              <TextInput
                id={id}
                defaultValue={filters.get('q') ?? ''}
                placeholder="a1b2c3d4-… or 98765"
                onBlur={(event) => filters.set('q', event.target.value.trim() || undefined)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    filters.set('q', event.currentTarget.value.trim() || undefined);
                  }
                }}
              />
            )}
          </Field>

          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={filters.get('status') ?? ''}
                onChange={(event) => filters.set('status', event.target.value || undefined)}
              >
                <option value="">Any status</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Created from">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={from ?? ''}
                onChange={(event) => filters.set('from', event.target.value || undefined)}
              />
            )}
          </Field>

          <Field label="Created to">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={to ?? ''}
                onChange={(event) => filters.set('to', event.target.value || undefined)}
              />
            )}
          </Field>
        </div>

        {query.status === 'pending' ? (
          <SkeletonRows rows={8} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No booking matches that."
            description="A full booking id matches exactly; anything else is treated as a phone fragment."
          />
        ) : (
          <div className="p-3">
            <div className="mb-2.5 flex items-center gap-1.5 px-1 text-xs text-slate-500">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
              <span className="tabular-nums">{query.data.total}</span>
              <span>matching {query.data.total === 1 ? 'booking' : 'bookings'}</span>
            </div>
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
        )}
      </Card>
    </div>
  );
}
