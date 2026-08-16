import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchBookings } from '../api/endpoints';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Field, Select, TextInput } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { QueryState } from '../components/ui/States';
import { Table, Td, Th, Tr } from '../components/ui/Table';
import { useFilters } from '../lib/filters';
import { formatPaise } from '../lib/money';
import { dateInputToIso } from '../lib/time';

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

export function BookingsPage() {
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

  const query = useQuery({ queryKey: ['bookings', params], queryFn: () => fetchBookings(params) });

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="One search box. Paste a booking id, or type the phone number the caller read out — either side of the job."
      />

      <Card className="mb-4" title="Search">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      </Card>

      <Card title="Results">
        <QueryState
          status={query.status}
          error={query.error}
          data={query.data}
          loadingLabel="Searching bookings…"
          isEmpty={(page) => page.items.length === 0}
          empty={{
            title: 'No booking matches that.',
            hint: 'A full booking id matches exactly; anything else is treated as a phone fragment.',
          }}
          onRetry={() => void query.refetch()}
        >
          {(page) => (
            <>
              <Table
                head={
                  <tr>
                    <Th>Booking</Th>
                    <Th>Status</Th>
                    <Th>Customer</Th>
                    <Th>Technician</Th>
                    <Th>Category</Th>
                    <Th>Starts</Th>
                    <Th>Payable</Th>
                    <Th>Created</Th>
                  </tr>
                }
              >
                {page.items.map((booking) => (
                  <Tr key={booking.id}>
                    <Td>
                      <Link
                        className="font-medium text-blue-700 hover:underline"
                        to={`/bookings/${booking.id}`}
                      >
                        {booking.id.slice(0, 8)}…
                      </Link>
                    </Td>
                    <Td>
                      <StatusBadge status={booking.status} />
                    </Td>
                    <Td>
                      {booking.customer?.name ?? '—'}
                      <div className="text-xs text-slate-500">{booking.customer?.phone}</div>
                    </Td>
                    <Td>
                      {booking.provider ? (
                        <Link
                          className="text-blue-700 hover:underline"
                          to={`/providers/${booking.provider.userId}`}
                        >
                          {booking.provider.displayName ?? booking.provider.userId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>{booking.category?.nameKey ?? '—'}</Td>
                    <Td>
                      <Timestamp value={booking.startsAt} />
                    </Td>
                    <Td className="tabular-nums">
                      {booking.payablePaise === null ? '—' : formatPaise(booking.payablePaise)}
                    </Td>
                    <Td>
                      <Timestamp value={booking.createdAt} />
                    </Td>
                  </Tr>
                ))}
              </Table>
              <Pagination
                page={page.page}
                pageSize={page.pageSize}
                total={page.total}
                onChange={filters.setPage}
              />
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
