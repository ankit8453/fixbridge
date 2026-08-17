'use client';

import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { formatPaise } from '@/lib/money';
import { useDeclineWork } from '@/components/customer/data/bookings';
import { Button, ErrorState, Field, Modal, TextArea } from '@/components/ui';

/** "Decline work" is only legal from IN_PROGRESS with no quotation currently pending or approved. */
export function canDeclineWork(
  status: string,
  hasPendingQuotation: boolean,
  hasApprovedQuotation: boolean,
): boolean {
  return status === 'IN_PROGRESS' && !hasPendingQuotation && !hasApprovedQuotation;
}

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
        <p className="text-sm text-slate-700">
          {t('app.booking.declineWorkFeeExplanation', { fee: formatPaise(visitFeePaise) })}
        </p>

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
