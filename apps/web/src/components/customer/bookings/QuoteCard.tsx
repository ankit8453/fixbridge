'use client';

import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { formatPaise } from '@/lib/money';
import { useApproveQuotation, useRejectQuotation } from '@/components/customer/data/quotations';
import { Badge, Button, ErrorState, TextArea } from '@/components/ui';
import type { QuotationView } from '@/components/customer/data/types';

const STATUS_TONE = {
  sent: 'info',
  approved: 'good',
  rejected: 'bad',
  superseded: 'neutral',
  withdrawn: 'neutral',
} as const;

/**
 * Line items, the labour/parts/total math, and — only for the quotation
 * currently awaiting a decision — approve/reject.
 *
 * The total is never recomputed here; every figure rendered
 * (`labourPaise`, each `lineTotalPaise`, `totalPaise`) comes straight from
 * the API response, which is itself checked twice server-side (a pure
 * function and a database CHECK — see `docs/bookings.md` "Money math"). This
 * component's job is only to lay the same numbers out so a customer can add
 * them up by eye, not to re-derive them.
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

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {t('app.booking.quoteVersion', { version: quotation.version })}
        </h3>
        <Badge tone={STATUS_TONE[quotation.status]}>
          {t(`app.quoteStatus.${quotation.status}`)}
        </Badge>
      </div>

      {quotation.note ? <p className="mt-1 text-sm text-slate-600">{quotation.note}</p> : null}

      {quotation.items.length > 0 ? (
        <div className="mt-3 divide-y divide-slate-100 text-sm">
          {quotation.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-2 py-1.5">
              <div>
                <p className="text-slate-700">{item.description}</p>
                <p className="text-xs text-slate-400">
                  {item.qty} × {formatPaise(item.unitPaise)}
                </p>
              </div>
              <span className="shrink-0 tabular-nums text-slate-900">
                {formatPaise(item.lineTotalPaise)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <dl className="mt-3 divide-y divide-slate-100 text-sm">
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-slate-700">{t('app.booking.labour')}</dt>
          <dd className="tabular-nums text-slate-900">{formatPaise(quotation.labourPaise)}</dd>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-slate-700">{t('app.booking.partsTotal')}</dt>
          <dd className="tabular-nums text-slate-900">{formatPaise(quotation.partsTotalPaise)}</dd>
        </div>
        <div className="flex items-center justify-between py-2 text-base font-semibold">
          <dt>{t('app.booking.quoteTotal')}</dt>
          <dd className="tabular-nums">{quotation.totalDisplay}</dd>
        </div>
      </dl>

      {isPending && quotation.status === 'sent' ? (
        <div className="mt-2 flex flex-col gap-2">
          {approve.isError ? <ErrorState error={approve.error} /> : null}
          {reject.isError ? <ErrorState error={reject.error} /> : null}

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
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setRejecting(true)}>
                {t('app.booking.rejectQuote')}
              </Button>
              <Button
                variant="primary"
                fullWidth
                disabled={approve.isPending}
                onClick={() => approve.mutate({ quotationId: quotation.id })}
              >
                {approve.isPending ? t('common.loading') : t('app.booking.approveQuote')}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
