'use client';

import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { useMyBookings } from '@/components/customer/data/bookings';
import { BookingListItem } from '@/components/customer/bookings/BookingListItem';
import { QueryState } from '@/components/ui';
import type { BookingStatus } from '@/components/customer/data/types';

const ACTIVE_STATUSES = new Set<BookingStatus>([
  'REQUESTED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
]);

type Tab = 'active' | 'past';

export default function BookingsListPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('active');
  const query = useMyBookings();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('app.bookings.title')}</h1>

      <div className="flex gap-2" role="tablist">
        {(['active', 'past'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`min-h-touch flex-1 rounded-lg border px-3 text-sm font-medium ${
              tab === value
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-slate-300 text-slate-700'
            }`}
          >
            {t(`app.bookings.tab.${value}`)}
          </button>
        ))}
      </div>

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel={t('app.bookings.loading')}
        empty={{ title: t('app.bookings.empty'), hint: t('app.bookings.emptyHint') }}
        isEmpty={(data) =>
          data.bookings.filter((b) => (tab === 'active') === ACTIVE_STATUSES.has(b.status))
            .length === 0
        }
        onRetry={() => void query.refetch()}
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            {data.bookings
              .filter((b) => (tab === 'active') === ACTIVE_STATUSES.has(b.status))
              .map((booking) => (
                <BookingListItem key={booking.id} booking={booking} />
              ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
