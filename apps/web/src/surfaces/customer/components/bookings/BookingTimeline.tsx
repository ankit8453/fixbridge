import { useT } from '@/i18n/useT';
import type { BookingEventView } from '@/surfaces/customer/data/types';

/**
 * Event types that are evidence, not narrative — a wrong handshake attempt or
 * a superseded quote version. Shown in the raw event log ops can see, not
 * repeated here as a timeline "step"; the timeline is the customer-facing
 * story of the job, not a full audit trail. Ported from
 * `legacy-next-src/components/customer/bookings/BookingTimeline.tsx`.
 */
const SKIP_EVENT_TYPES = new Set(['otp_failed', 'otp_locked', 'quote_sent', 'quote_withdrawn']);

export function BookingTimeline({ events }: { events: BookingEventView[] }) {
  const t = useT();
  const visible = events.filter((event) => !SKIP_EVENT_TYPES.has(event.eventType));

  if (visible.length === 0) return null;

  return (
    <ol className="flex flex-col gap-3">
      {visible.map((event, index) => (
        <li key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`mt-1 h-2.5 w-2.5 rounded-full ${
                index === visible.length - 1 ? 'bg-shop' : 'bg-slate-300'
              }`}
            />
            {index < visible.length - 1 ? <span className="w-px flex-1 bg-slate-200" /> : null}
          </div>
          <div className="pb-3">
            <p className="text-sm font-medium text-shop-ink">
              {t(`app.bookingEvent.${event.eventType}`)}
            </p>
            <p className="text-xs text-shop-ink-soft">
              {new Date(event.createdAt).toLocaleString(undefined, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
