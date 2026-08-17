'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { Badge } from '@/components/ui';
import { istDateLabel, istTime } from '@/components/customer/data/ist-date';
import type { BookingDetail } from '@/components/customer/data/types';

const STATUS_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  REQUESTED: 'warn',
  ACCEPTED: 'info',
  EN_ROUTE: 'info',
  ARRIVED: 'info',
  IN_PROGRESS: 'info',
  WORK_DONE: 'good',
  REJECTED: 'bad',
  EXPIRED: 'bad',
  CANCELLED_BY_CUSTOMER: 'neutral',
  CANCELLED_BY_PROVIDER: 'neutral',
  CLOSED_QUOTE_DECLINED: 'neutral',
};

export function BookingListItem({ booking }: { booking: BookingDetail }) {
  const t = useT();
  const locale = useLocale();

  return (
    <Link
      href={buildLocalizedHref(locale, `/app/bookings/${booking.id}`)}
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors active:bg-slate-50"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">
          {booking.counterpart.name ?? t('app.find.unnamedProvider')}
        </p>
        <p className="text-xs text-slate-500">
          {istDateLabel(booking.startsAt)} · {istTime(booking.startsAt)}
        </p>
      </div>
      <Badge tone={STATUS_TONE[booking.status] ?? 'neutral'}>
        {t(`app.bookingStatus.${booking.status}`)}
      </Badge>
    </Link>
  );
}
