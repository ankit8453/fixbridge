import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { formatPaise } from '@/lib/money';
import { useDeclineWork } from '@/surfaces/customer/data/bookings';
import { Button, ErrorState, Field, Modal, TextArea } from '@/components/ui';

/** "Decline work" is only legal from IN_PROGRESS with no quotation currently pending or approved. */
export function canDeclineWork(
  status: string,
  hasPendingQuotation: boolean,
  hasApprovedQuotation: boolean,
): boolean {
  return status === 'IN_PROGRESS' && !hasPendingQuotation && !hasApprovedQuotation;
}

/** Ported from `legacy-next-src/components/customer/bookings/DeclineWorkDialog.tsx`. */
export function DeclineWorkDialog({
  bookingId,
  visitFeePaise,
  onClose,
}: {
  bookingId: string;
  visitFeePaise: number;
  onClose: () => void;
}) {
  const t = useT();
  const decline = useDeclineWork(bookingId);
  const [note, setNote] = useState('');

  return (
    <Modal title={t('app.booking.declineWorkTitle')} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        {/*
          The fee is the whole decision, so it is a figure the eye lands on
          before the sentence explaining it — a customer skimming a modal
          should never approve a charge they only read as prose.
        */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70">
            {t('app.booking.declineWorkFeeLabel')}
          </p>
          <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-amber-900">
            {formatPaise(visitFeePaise)}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-amber-900/85">
            {t('app.booking.declineWorkFeeReason')}
          </p>
        </div>

        <Field label={t('app.booking.declineWorkNoteLabel')}>
          {(id) => (
            <TextArea
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          )}
        </Field>

        {decline.isError ? <ErrorState error={decline.error} /> : null}

        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            fullWidth
            disabled={decline.isPending}
            onClick={() =>
              decline.mutate({ note: note.trim() || undefined }, { onSuccess: onClose })
            }
          >
            {decline.isPending ? t('common.loading') : t('app.booking.confirmDeclineWork')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
