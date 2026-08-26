import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { formatPaise } from '@/lib/money';
import { useApproveQuotation, useRejectQuotation } from '@/surfaces/customer/data/quotations';
import { IconTag } from './BookingIcons';
import { Badge, Button, ErrorState, TextArea, type Tone } from '@/components/ui';
import type { QuotationView } from '@/surfaces/customer/data/types';

const STATUS_TONE: Record<QuotationView['status'], Tone> = {
  sent: 'info',
  approved: 'success',
  rejected: 'danger',
  superseded: 'neutral',
  withdrawn: 'neutral',
};

/**
 * The labour breakdown a quotation *may* carry.
 *
 * The API stores three extra columns on every quotation —
 * `agreedLabourPaise` (what the customer's booked price card promised),
 * `extraLabourPaise` (anything above it) and `extraLabourReason` (why) — and
 * derives them server-side rather than trusting the partner app
 * (`apps/api/src/modules/quotations/service.ts`). They are the product's core
 * transparency promise: a customer should be able to see, in writing, exactly
 * how much of the labour charge is the price they agreed to and how much is
 * new, with the reason next to the amount.
 *
 * They are **not** on this app's `QuotationView` type, because the API's own
 * `toQuotationView` does not currently serialise them (see the note in the
 * report accompanying this redesign — that is an API bug, not a UI one). So
 * this component reads them structurally: the moment the server starts sending
 * them, the split renders with no further change here, and until then the
 * single `labourPaise` line is shown exactly as before.
 *
 * Written as a narrowing helper rather than a cast so the absence is handled
 * once, in one place, instead of at three render sites.
 */
interface LabourSplit {
  agreedPaise: number;
  extraPaise: number;
  reason: string | null;
}

function labourSplitOf(quotation: QuotationView): LabourSplit | null {
  const raw = quotation as QuotationView & {
    agreedLabourPaise?: unknown;
    extraLabourPaise?: unknown;
    extraLabourReason?: unknown;
  };

  const agreedPaise = raw.agreedLabourPaise;
  const extraPaise = raw.extraLabourPaise;

  if (typeof agreedPaise !== 'number' || typeof extraPaise !== 'number') return null;
  // Nothing extra is not a "split" — one labour line already tells the whole
  // truth, and an "Extra labour ₹0" row is noise on the screen where the
  // customer is being asked to agree to a number.
  if (extraPaise <= 0) return null;

  return {
    agreedPaise,
    extraPaise,
    reason: typeof raw.extraLabourReason === 'string' ? raw.extraLabourReason : null,
  };
}

/**
 * The screen where a customer agrees to a price.
 *
 * Every figure rendered (`labourPaise`, each `lineTotalPaise`, `totalPaise`)
 * comes straight from the API response, which is itself checked twice
 * server-side (a pure function and a database CHECK — see `docs/bookings.md`
 * "Money math"). This component's job is only to lay the same numbers out so a
 * customer can add them up by eye, never to re-derive them.
 *
 * The layout follows the order somebody actually checks a bill: the parts they
 * can see and count, then the labour, then one total that is visibly the sum.
 * Approve and reject are deliberately not a matched pair of equal buttons —
 * approving is agreeing to pay money, so it is the only filled control, and
 * rejecting takes a second, explicit step with a reason box rather than firing
 * on the first tap.
 */
export function QuoteCard({
  bookingId,
  quotation,
  isPending,
}: {
  bookingId: string;
  quotation: QuotationView;
  isPending: boolean;
}) {
  const t = useT();
  const approve = useApproveQuotation(bookingId);
  const reject = useRejectQuotation(bookingId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const awaitingDecision = isPending && quotation.status === 'sent';
  const labour = labourSplitOf(quotation);

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white ${
        awaitingDecision ? 'border-shop shadow-sm' : 'border-shop-line'
      }`}
    >
      {/* ---------------- Heading ---------------- */}
      <div className="flex items-center gap-2.5 border-b border-shop-line px-4 py-2.5">
        <IconTag className="h-[18px] w-[18px] shrink-0 text-shop" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-shop-ink">
          {t('app.booking.quoteVersion', { version: quotation.version })}
        </h3>
        <Badge tone={STATUS_TONE[quotation.status]}>
          {t(`app.quoteStatus.${quotation.status}`)}
        </Badge>
      </div>

      <div className="px-4 py-3">
        {quotation.note ? (
          <p className="mb-3 rounded-lg bg-shop-soft/60 px-3 py-2 text-[13px] leading-relaxed text-shop-ink">
            {quotation.note}
          </p>
        ) : null}

        {/* ---------------- Parts ---------------- */}
        {quotation.items.length > 0 ? (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-shop-ink-soft">
              {t('app.booking.partsHeading')}
            </p>
            <ul className="mt-1.5">
              {quotation.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-3 py-1">
                  <span className="min-w-0">
                    <span className="block text-sm leading-snug text-shop-ink">
                      {item.description}
                    </span>
                    <span className="block text-xs text-shop-ink-soft">
                      {item.qty} × {formatPaise(item.unitPaise)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-shop-ink">
                    {formatPaise(item.lineTotalPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {/* ---------------- The money ---------------- */}
        <dl
          className={`text-sm ${quotation.items.length > 0 ? 'mt-3 border-t border-shop-line pt-2.5' : ''}`}
        >
          {labour ? (
            <>
              {/*
                The agreed figure first, and named as agreed — it is the number
                the customer already said yes to when they booked, and seeing it
                unchanged is what makes the extra line below readable as an
                addition rather than as a price that moved.
              */}
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-shop-ink-soft">{t('app.booking.agreedLabour')}</dt>
                <dd className="shrink-0 tabular-nums text-shop-ink">
                  {formatPaise(labour.agreedPaise)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="min-w-0">
                  <span className="block font-medium text-amber-800">
                    {t('app.booking.extraLabour')}
                  </span>
                  {/*
                    The reason sits directly under its own amount, never in a
                    footnote. An extra charge with the explanation somewhere
                    else on the page is exactly the experience this product
                    exists to replace.
                  */}
                  <span className="block text-xs leading-snug text-shop-ink-soft">
                    {labour.reason ?? t('app.booking.extraLabourNoReason')}
                  </span>
                </dt>
                <dd className="shrink-0 font-semibold tabular-nums text-amber-800">
                  {formatPaise(labour.extraPaise)}
                </dd>
              </div>
            </>
          ) : (
            <div className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-shop-ink-soft">{t('app.booking.labour')}</dt>
              <dd className="shrink-0 tabular-nums text-shop-ink">
                {formatPaise(quotation.labourPaise)}
              </dd>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-shop-ink-soft">{t('app.booking.partsTotal')}</dt>
            <dd className="shrink-0 tabular-nums text-shop-ink">
              {formatPaise(quotation.partsTotalPaise)}
            </dd>
          </div>

          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t-2 border-shop-ink/10 pt-2">
            <dt className="text-[15px] font-bold text-shop-ink">{t('app.booking.quoteTotal')}</dt>
            {/* `totalDisplay` verbatim — the API's own rendering of the integer
                paise total, never re-formatted or re-added here. */}
            <dd className="shrink-0 text-[19px] font-bold leading-none tabular-nums text-shop-ink">
              {quotation.totalDisplay}
            </dd>
          </div>
        </dl>
      </div>

      {/* ---------------- Decision ---------------- */}
      {awaitingDecision ? (
        <div className="border-t border-shop-line bg-shop-soft/40 px-4 py-3">
          {approve.isError ? (
            <div className="mb-2">
              <ErrorState error={approve.error} />
            </div>
          ) : null}
          {reject.isError ? (
            <div className="mb-2">
              <ErrorState error={reject.error} />
            </div>
          ) : null}

          {rejecting ? (
            <div className="flex flex-col gap-2">
              <TextArea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('app.booking.rejectReasonPlaceholder')}
                maxLength={200}
              />
              <div className="flex gap-2">
                <Button variant="secondary" fullWidth onClick={() => setRejecting(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  fullWidth
                  disabled={reject.isPending}
                  onClick={() =>
                    reject.mutate({ quotationId: quotation.id, reason: reason.trim() || undefined })
                  }
                >
                  {t('app.booking.confirmReject')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-2.5 text-center text-xs text-shop-ink-soft">
                {t('app.booking.approveHint')}
              </p>
              {/*
                Approve is the filled plum control and sits alone on its own
                row; reject is a quiet text control underneath. They are not a
                symmetric pair because the two outcomes are not symmetric — one
                commits the customer to paying, the other opens a reason box.
              */}
              <button
                type="button"
                disabled={approve.isPending}
                onClick={() => approve.mutate({ quotationId: quotation.id })}
                className="min-h-touch w-full rounded-xl bg-shop px-4 py-2.5 text-base font-semibold text-shop-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {approve.isPending
                  ? t('common.loading')
                  : t('app.booking.approveQuoteAmount', { amount: quotation.totalDisplay })}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                className="min-h-touch mt-1 w-full text-sm font-medium text-shop-ink-soft underline-offset-2 hover:underline"
              >
                {t('app.booking.rejectQuote')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
