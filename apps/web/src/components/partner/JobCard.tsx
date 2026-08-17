'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT, useLocale } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { Badge } from '@/components/ui/Badge';
import { BOOKING_REQUEST_TTL_MINUTES } from './lib/constants';
import type { BookingDetail } from './lib/types';

function secondsRemaining(createdAt: string): number {
  const deadline = new Date(createdAt).getTime() + BOOKING_REQUEST_TTL_MINUTES * 60 * 1000;
  return Math.max(0, Math.round((deadline - Date.now()) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** One REQUESTED job in the inbox, with a live countdown to its (approximate) expiry. */
export function JobCard({ booking }: { booking: BookingDetail }) {
  const t = useT();
  const locale = useLocale();
  const [remaining, setRemaining] = useState(() => secondsRemaining(booking.createdAt));

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(secondsRemaining(booking.createdAt)), 1000);
    return () => window.clearInterval(timer);
  }, [booking.createdAt]);

  const urgent = remaining < 120;

  return (
    <Link
      href={buildLocalizedHref(locale, `/partner/jobs/${booking.id}`)}
      className="block min-h-touch rounded-xl border border-slate-200 bg-white p-4 active:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">
            {new Date(booking.startsAt).toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          {booking.problemNote ? (
            <p className="mt-1 truncate text-base font-medium text-slate-900">
              {booking.problemNote}
            </p>
          ) : (
            <p className="mt-1 text-base font-medium text-slate-500">
              {t('partner.jobs.noProblemNote')}
            </p>
          )}
        </div>
        <Badge tone={urgent ? 'bad' : 'warn'}>
          {remaining > 0 ? formatCountdown(remaining) : t('partner.jobs.expiring')}
        </Badge>
      </div>
    </Link>
  );
}
