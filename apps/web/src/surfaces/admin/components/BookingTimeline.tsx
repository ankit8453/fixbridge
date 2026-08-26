import { type ComponentType, type ReactNode } from 'react';
import {
  AlertTriangle,
  BellRing,
  CircleDot,
  FileText,
  IndianRupee,
  Star,
  type LucideProps,
} from 'lucide-react';
import { formatPaise } from '@/lib/money';
import type { BookingTimelineResponse } from '../lib/types';
import { Pill, type Tone } from './ui';
import { Timestamp } from './Timestamp';

/**
 * One booking's whole history, merged into a single chronological list.
 * Ported from `legacy-next-src/components/admin/BookingTimeline.tsx`.
 *
 * This is the dispute screen. When a customer says they were overcharged
 * and a technician says they were not, four separate record types settle it
 * and they only settle it *interleaved*: the event log, the quotation
 * versions, the payments, and what each side was actually told. Four
 * side-by-side tables would make the reader do the merge in their head, and
 * the whole question is what happened before what.
 *
 * The actor label matters as much as the ordering — "cancelled" answers
 * nothing; "cancelled by the technician" is the answer.
 *
 * Rendered as a single rail with one node per entry, so "what happened
 * before what" is carried by the geometry rather than by the reader keeping
 * a running order in their head.
 */

interface Entry {
  at: string;
  kind: 'event' | 'quotation' | 'payment' | 'notification' | 'review' | 'complaint';
  actor: string;
  title: string;
  body?: ReactNode;
}

const KIND_TONE: Record<Entry['kind'], Tone> = {
  event: 'neutral',
  quotation: 'info',
  payment: 'success',
  notification: 'neutral',
  review: 'info',
  complaint: 'danger',
};

/** One glyph per record type — the rail is scanned for a kind before it is read. */
const KIND_ICON: Record<Entry['kind'], ComponentType<LucideProps>> = {
  event: CircleDot,
  quotation: FileText,
  payment: IndianRupee,
  notification: BellRing,
  review: Star,
  complaint: AlertTriangle,
};

/** The node ring, matching `Pill`'s tone vocabulary so a row reads as one colour. */
const NODE_TONE: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-100 text-slate-500',
  admin: 'border-admin/20 bg-admin-soft text-admin',
  success: 'border-success/20 bg-success/10 text-success',
  warning: 'border-warning/20 bg-warning/10 text-warning',
  danger: 'border-danger/20 bg-danger/10 text-danger',
  info: 'border-admin-alt/20 bg-admin-alt/10 text-admin-alt',
};

export function buildTimeline(data: BookingTimelineResponse): Entry[] {
  const { booking, notifications } = data;
  const entries: Entry[] = [];

  for (const event of booking.events) {
    entries.push({
      at: event.createdAt,
      kind: 'event',
      actor: event.actorType ?? 'system',
      title: event.eventType,
      body:
        event.payload === null || event.payload === undefined ? undefined : (
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        ),
    });
  }

  for (const quote of booking.quotations) {
    entries.push({
      at: quote.createdAt,
      kind: 'quotation',
      actor: 'technician',
      title: `Quotation v${quote.version} — ${quote.status}`,
      body: (
        <div>
          <div className="text-[15px] font-semibold tabular-nums text-slate-900">
            {quote.totalPaise === null ? '—' : formatPaise(quote.totalPaise)}
          </div>
          {(quote.items ?? []).length > 0 ? (
            <ul className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(quote.items ?? []).map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline justify-between gap-4 px-2.5 py-1.5 text-xs"
                >
                  <span className="min-w-0 text-slate-600">
                    {item.description}
                    {item.quantity && item.quantity !== 1 ? (
                      <span className="text-slate-400"> × {item.quantity}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-900">
                    {formatPaise(item.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ),
    });
  }

  for (const payment of booking.payments) {
    entries.push({
      at: payment.createdAt,
      kind: 'payment',
      actor: payment.method === 'cash' ? 'technician (cash)' : 'gateway',
      title: `Payment ${payment.status} — ${formatPaise(payment.amountPaise)} by ${payment.method}`,
    });

    for (const refund of payment.refunds ?? []) {
      entries.push({
        at: refund.createdAt,
        kind: 'payment',
        actor: 'ops',
        title: `Refund ${refund.status} — ${formatPaise(refund.amountPaise)}`,
      });
    }
  }

  for (const review of booking.reviews) {
    entries.push({
      at: review.createdAt,
      kind: 'review',
      actor: review.direction ?? 'party',
      title: `Review — ${review.stars} stars`,
      body: review.text ? (
        <p className="text-[13px] leading-relaxed text-slate-700">{review.text}</p>
      ) : undefined,
    });
  }

  for (const complaint of booking.complaints) {
    entries.push({
      at: complaint.createdAt,
      kind: 'complaint',
      actor: 'party',
      title: `Complaint (${complaint.category}) — ${complaint.status}`,
    });
  }

  for (const notification of notifications) {
    entries.push({
      at: notification.createdAt,
      kind: 'notification',
      // "Nobody told me" is the second thing every dispute turns on, so the
      // recipient's name is the point of this row.
      actor: `to ${notification.user?.name ?? notification.user?.id ?? 'unknown'}`,
      title: `Notified: ${notification.topic}`,
      body: (
        <div className="flex flex-wrap gap-1">
          {(notification.deliveries ?? []).map((delivery) => (
            <span
              key={delivery.id}
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
            >
              {delivery.channel}: {delivery.status}
            </span>
          ))}
        </div>
      ),
    });
  }

  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function BookingTimeline({ data }: { data: BookingTimelineResponse }) {
  const entries = buildTimeline(data);

  if (entries.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-[13px] text-slate-500">
        Nothing has happened on this booking yet.
      </p>
    );
  }

  return (
    <ol className="relative">
      {entries.map((entry, index) => {
        const Icon = KIND_ICON[entry.kind];
        const last = index === entries.length - 1;

        return (
          <li key={`${entry.at}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The connector stops at the final node so the rail reads as
                "and then nothing", not as an unfinished list. */}
            {last ? null : (
              <span
                aria-hidden="true"
                className="absolute left-[13px] top-7 bottom-0 w-px bg-slate-200"
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border ${NODE_TONE[KIND_TONE[entry.kind]]}`}
            >
              <Icon className="h-[13px] w-[13px]" strokeWidth={2} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Pill tone={KIND_TONE[entry.kind]}>{entry.kind}</Pill>
                <span className="text-[13px] font-semibold text-slate-900">{entry.title}</span>
                <span className="text-xs text-slate-500">{entry.actor}</span>
                <span className="ml-auto text-xs">
                  <Timestamp value={entry.at} />
                </span>
              </div>
              {entry.body ? <div className="mt-1.5">{entry.body}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
