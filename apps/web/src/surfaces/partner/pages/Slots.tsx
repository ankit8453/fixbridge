import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { QueryState, StatusPill } from '../../../components/ui';
import { blockSlot, fetchMySlots, unblockSlot } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { OwnSlot } from '../lib/types';

const HORIZON_DAYS = 7;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The week view of the technician's own materialised slots, and the
 * "chhutti" (day off) block/unblock button.
 *
 * Ported from `legacy-next-src/app/[locale]/partner/(protected)/slots/page.tsx`,
 * but built on `GET /api/v1/providers/me/slots?from=&to=` — added this
 * phase — rather than the legacy page's workaround. The legacy screen could
 * only ever see `open` slots (the public `/providers/:id/slots` endpoint
 * withholds status from strangers by design) and faked "what did I already
 * block" with a same-session-only `justBlocked` map that forgot everything
 * on reload. The owner-scoped endpoint returns `status` (`open`/`blocked`/
 * `booked`) and `bookingId` directly, so this screen shows the real state on
 * every visit — blocked hours stay visibly blocked, booked hours link
 * straight to the job, and un-blocking works regardless of which session
 * did the blocking.
 */
export default function Slots() {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();

  const range = useMemo(() => {
    const from = new Date();
    from.setMinutes(0, 0, 0);
    const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const slotsKey = partnerKeys.slots(range.from, range.to);
  const slotsQuery = useQuery({
    queryKey: slotsKey,
    queryFn: () => fetchMySlots(range.from, range.to),
  });

  const block = useMutation({
    mutationFn: (slotId: string) => blockSlot(slotId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: slotsKey }),
  });

  const unblock = useMutation({
    mutationFn: (slotId: string) => unblockSlot(slotId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: slotsKey }),
  });

  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.slots.title')}</h1>
      <p className="text-sm text-muted">{t('partner.slots.hint')}</p>

      <QueryState
        status={slotsQuery.status}
        error={slotsQuery.error}
        data={slotsQuery.data}
        onRetry={() => slotsQuery.refetch()}
        empty={{ title: t('partner.slots.empty') }}
        isEmpty={(data) => data.slots.length === 0}
      >
        {(data) => {
          const byDay = new Map<string, OwnSlot[]>();
          for (const slot of data.slots) {
            const key = dayKey(slot.startsAt);
            byDay.set(key, [...(byDay.get(key) ?? []), slot]);
          }

          return (
            <ul className="flex flex-col gap-4">
              {[...byDay.entries()].map(([day, slots]) => (
                <li key={day}>
                  <p className="mb-2 text-sm font-semibold text-slate-600">
                    {new Date(day).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                      weekday: 'long',
                      day: '2-digit',
                      month: 'short',
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot) => {
                      if (slot.status === 'booked') {
                        return (
                          <Link
                            key={slot.id}
                            to={buildLocalizedHref(locale, `/partner/jobs/${slot.bookingId}`)}
                            className="min-h-touch rounded-lg border border-brand bg-white px-3 text-sm font-medium text-brand"
                          >
                            {timeLabel(slot.startsAt)}
                          </Link>
                        );
                      }

                      if (slot.status === 'blocked') {
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            disabled={unblock.isPending}
                            onClick={() => unblock.mutate(slot.id)}
                            className="flex min-h-touch items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800"
                          >
                            {timeLabel(slot.startsAt)}
                            <StatusPill tone="warning">{t('partner.slots.blocked')}</StatusPill>
                          </button>
                        );
                      }

                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={block.isPending}
                          onClick={() => block.mutate(slot.id)}
                          className="min-h-touch rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 transition-colors duration-150 active:bg-slate-100"
                        >
                          {timeLabel(slot.startsAt)}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>

      {block.isPending || unblock.isPending ? (
        <p className="text-sm text-muted">{t('partner.common.saving')}</p>
      ) : null}
    </div>
  );
}
