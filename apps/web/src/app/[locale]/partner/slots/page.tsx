'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { useLocale, useT } from '@/i18n/useT';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/States';
import { blockSlot, fetchMySlots, unblockSlot } from '@/components/partner/lib/api';
import { partnerKeys } from '@/components/partner/lib/query-keys';

const HORIZON_DAYS = 7;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The week view of materialised slots, and the "chhutti" (day off) button
 * (PHASE12_PROMPT.md §C.6).
 *
 * **Known gap, not a shortcut**: `GET /providers/:id/slots` only ever
 * returns `open` slots — by design, for a stranger looking at a technician's
 * calendar (docs/API.md: "who booked what, and when a technician took the
 * afternoon off, is nobody else's business"). There is no owner-scoped
 * endpoint that also returns the technician's own `booked`/`blocked` slots,
 * so this screen can show and block open hours, but a slot blocked in an
 * earlier visit is invisible here on a later one — nothing in the API can
 * list it back. `justBlocked` below is a same-session-only workaround (an
 * immediate "undo" using the slot the block response just echoed back), not
 * a fix for that. Flagged in the phase report; the real fix is a
 * `GET /providers/me/slots?status=` endpoint.
 */
export default function SlotsPage() {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [justBlocked, setJustBlocked] = useState<
    Record<string, { startsAt: string; endsAt: string }>
  >({});

  const range = useMemo(() => {
    const from = new Date();
    from.setMinutes(0, 0, 0);
    const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const slotsKey = partnerKeys.slots(range.from, range.to);
  const slotsQuery = useQuery({
    queryKey: slotsKey,
    queryFn: () => fetchMySlots(user?.id ?? '', range.from, range.to),
    enabled: Boolean(user?.id),
  });

  const block = useMutation({
    mutationFn: (slotId: string) => blockSlot(slotId),
    onSuccess: ({ slot }) => {
      setJustBlocked((prev) => ({
        ...prev,
        [slot.id]: { startsAt: slot.startsAt, endsAt: slot.endsAt },
      }));
      queryClient.invalidateQueries({ queryKey: slotsKey });
    },
  });

  const unblock = useMutation({
    mutationFn: (slotId: string) => unblockSlot(slotId),
    onSuccess: (_result, slotId) => {
      setJustBlocked((prev) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: slotsKey });
    },
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.slots.title')}</h1>
      <p className="text-sm text-slate-500">{t('partner.slots.hint')}</p>

      <QueryState
        status={slotsQuery.status}
        error={slotsQuery.error}
        data={slotsQuery.data}
        onRetry={() => slotsQuery.refetch()}
        empty={{ title: t('partner.slots.empty') }}
        isEmpty={(data) => data.slots.length === 0}
      >
        {(data) => {
          const byDay = new Map<string, typeof data.slots>();
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
                    {slots.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={block.isPending}
                        onClick={() => block.mutate(slot.id)}
                        className="min-h-touch rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 active:bg-slate-100"
                      >
                        {new Date(slot.startsAt).toLocaleTimeString(
                          locale === 'hi' ? 'hi-IN' : 'en-IN',
                          {
                            hour: '2-digit',
                            minute: '2-digit',
                          },
                        )}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>

      {Object.keys(justBlocked).length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            {t('partner.slots.justBlockedTitle')}
          </p>
          <ul className="flex flex-col gap-2">
            {Object.entries(justBlocked).map(([slotId, slot]) => (
              <li key={slotId} className="flex items-center justify-between gap-2">
                <span className="text-sm text-amber-900">
                  {new Date(slot.startsAt).toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <Button
                  variant="secondary"
                  disabled={unblock.isPending}
                  onClick={() => unblock.mutate(slotId)}
                >
                  {t('partner.slots.undo')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
