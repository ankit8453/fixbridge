import { type ReactNode } from 'react';
import { Badge, type Tone } from '@/components/ui';
import { formatPaise } from '@/lib/money';
import type { BookingTimelineResponse } from '../lib/types';
import { Timestamp } from './Timestamp';

/**
 * One booking's whole history, merged into a single chronological list.
 * Ported from `legacy-next-src/components/admin/BookingTimeline.tsx` onto
 * this app's `Badge`/`formatPaise`.
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
          <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
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
        <div className="text-sm text-slate-700">
          <div className="font-medium">
            {quote.totalPaise === null ? '—' : formatPaise(quote.totalPaise)}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
            {(quote.items ?? []).map((item) => (
              <li key={item.id}>
                {item.description} — {formatPaise(item.amountPaise)}
                {item.quantity && item.quantity !== 1 ? ` × ${item.quantity}` : ''}
              </li>
            ))}
          </ul>
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
      body: review.text ? <p className="text-sm text-slate-700">{review.text}</p> : undefined,
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
        <div className="flex flex-wrap gap-1 text-xs">
          {(notification.deliveries ?? []).map((delivery) => (
            <span key={delivery.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
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
    return <p className="text-sm text-muted">Nothing has happened on this booking yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="border-l-2 border-slate-200 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={KIND_TONE[entry.kind]}>{entry.kind}</Badge>
            <span className="text-sm font-medium text-slate-800">{entry.title}</span>
            <span className="text-xs text-muted">{entry.actor}</span>
            <span className="text-xs text-slate-400">
              <Timestamp value={entry.at} />
            </span>
          </div>
          {entry.body ? <div className="mt-1">{entry.body}</div> : null}
        </li>
      ))}
    </ol>
  );
}
