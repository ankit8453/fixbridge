import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Loader2 } from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { QueryState } from '../../../components/ui';
import { PageHeader, Panel } from '../components/ui';
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
 *
 * Layout is one column of days on a phone and a seven-column week grid from
 * `lg` up: the same data, but a technician planning the week at a desk can
 * see Monday and Saturday at once instead of scrolling a 448px strip.
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

  const intlLocale = locale === 'hi' ? 'hi-IN' : 'en-IN';

  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(intlLocale, {
      hour: '2-digit',
      minute: '2-digit',
    });

  const saving = block.isPending || unblock.isPending;

  return (
    <>
      <PageHeader
        title={t('partner.slots.title')}
        description={t('partner.slots.hint')}
        action={
          saving ? (
            <span
              role="status"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-500"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={2.5} />
              {t('partner.common.saving')}
            </span>
          ) : null
        }
      />

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
            <div className="flex flex-col gap-4">
              <Legend />

              {/* One column per day from `lg`; a single stacked column below,
                  where seven columns would be four slots wide each. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4 xl:grid-cols-7">
                {[...byDay.entries()].map(([day, slots]) => {
                  const date = new Date(day);
                  return (
                    <section
                      key={day}
                      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                    >
                      <header className="border-b border-slate-100 px-3 py-2.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {date.toLocaleDateString(intlLocale, { weekday: 'short' })}
                        </p>
                        <p className="mt-0.5 text-sm font-semibold tracking-tight text-slate-900">
                          {date.toLocaleDateString(intlLocale, {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </p>
                      </header>

                      <div className="flex flex-wrap gap-2 p-3 xl:flex-col">
                        {slots.map((slot) => {
                          if (slot.status === 'booked') {
                            return (
                              <Link
                                key={slot.id}
                                to={buildLocalizedHref(locale, `/partner/jobs/${slot.bookingId}`)}
                                className="flex min-h-touch flex-1 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 px-3 text-sm font-semibold tabular-nums text-brand transition-colors duration-150 hover:bg-brand/15 xl:flex-none"
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
                                title={t('partner.slots.blocked')}
                                className="flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 text-sm font-semibold tabular-nums text-warning transition-colors duration-150 hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-50 xl:flex-none"
                              >
                                <CalendarOff
                                  className="h-3.5 w-3.5 shrink-0"
                                  aria-hidden="true"
                                  strokeWidth={2}
                                />
                                <span className="line-through">{timeLabel(slot.startsAt)}</span>
                                <span className="sr-only">{t('partner.slots.blocked')}</span>
                              </button>
                            );
                          }

                          return (
                            <button
                              key={slot.id}
                              type="button"
                              disabled={block.isPending}
                              onClick={() => block.mutate(slot.id)}
                              className="flex min-h-touch flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium tabular-nums text-slate-700 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 xl:flex-none"
                            >
                              {timeLabel(slot.startsAt)}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

/**
 * Three colours carry the whole screen's meaning, and none of them is
 * self-evident — a legend is cheaper than a technician blocking a booked hour
 * to find out what the colour meant.
 */
function Legend() {
  const t = useT();

  return (
    <Panel className="lg:sticky lg:top-20">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <LegendItem swatch="border-slate-200 bg-white" label={t('partner.slots.legendOpen')} />
        <LegendItem
          swatch="border-warning/30 bg-warning/10"
          label={t('partner.slots.legendBlocked')}
        />
        <LegendItem swatch="border-brand/30 bg-brand/10" label={t('partner.slots.legendBooked')} />
      </ul>
    </Panel>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-slate-600">
      <span className={`h-4 w-4 shrink-0 rounded border ${swatch}`} aria-hidden="true" />
      {label}
    </li>
  );
}
