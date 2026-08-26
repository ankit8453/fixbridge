import { useT } from '@/i18n/useT';
import type { BookingEventView } from '@/surfaces/customer/data/types';

/**
 * Event types that are evidence, not narrative — a wrong handshake attempt or
 * a superseded quote version. Shown in the raw event log ops can see, not
 * repeated here as a timeline "step"; the timeline is the customer-facing
 * story of the job, not a full audit trail.
 */
const SKIP_EVENT_TYPES = new Set(['otp_failed', 'otp_locked', 'quote_sent', 'quote_withdrawn']);

/**
 * The job's story so far, newest step emphasised.
 *
 * The rail is a single continuous hairline with the dots sitting on it rather
 * than a stack of segments between dots — segments leave a visible seam at
 * every step on a low-DPI phone, which reads as a broken line rather than a
 * progression.
 */
export function BookingTimeline({ events }: { events: BookingEventView[] }) {
  const t = useT();
  const visible = events.filter((event) => !SKIP_EVENT_TYPES.has(event.eventType));

  if (visible.length === 0) return null;

  return (
    <ol className="relative flex flex-col">
      {visible.map((event, index) => {
        const isLatest = index === visible.length - 1;

        return (
          <li key={event.id} className="flex gap-3">
            <div className="relative flex w-3 shrink-0 flex-col items-center">
              {/* Line above and below the dot, drawn separately so the first
                  and last steps have no stub hanging off the end. */}
              {index > 0 ? <span className="h-2 w-px bg-shop-line" aria-hidden="true" /> : null}
              <span
                aria-hidden="true"
                className={
                  isLatest
                    ? 'h-2.5 w-2.5 shrink-0 rounded-full bg-shop ring-4 ring-shop-soft'
                    : 'h-2 w-2 shrink-0 rounded-full bg-shop-line'
                }
              />
              {!isLatest ? <span className="w-px flex-1 bg-shop-line" aria-hidden="true" /> : null}
            </div>

            <div className={isLatest ? 'pb-0.5 pt-0' : 'pb-3'}>
              <p
                className={`text-sm leading-tight ${
                  isLatest ? 'font-semibold text-shop-ink' : 'font-medium text-shop-ink-soft'
                }`}
              >
                {t(`app.bookingEvent.${event.eventType}`)}
              </p>
              <p className="mt-0.5 text-xs text-shop-ink-soft">
                {new Date(event.createdAt).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
