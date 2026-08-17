'use client';

import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { useCancelBooking } from '@/components/customer/data/bookings';
import {
  CUSTOMER_CANCEL_REASONS,
  type CustomerCancelReason,
} from '@/components/customer/data/types';
import { Button, ErrorState, Field, Modal, Select, TextArea } from '@/components/ui';

const CAN_CANCEL_STATUSES = new Set(['REQUESTED', 'ACCEPTED', 'EN_ROUTE']);

/** Cancellation is allowed exactly where the state machine allows it — nothing cancels from ARRIVED onward. */
export function canCancelBooking(status: string): boolean {
  return CAN_CANCEL_STATUSES.has(status);
}

export function CancelDialog({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const t = useT();
  const cancel = useCancelBooking(bookingId);
  const [reason, setReason] = useState<CustomerCancelReason>('changed_mind');
  const [note, setNote] = useState('');

  const noteRequired = reason === 'other';

  return (
    <Modal title={t('app.booking.cancelTitle')} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <Field label={t('app.booking.cancelReasonLabel')}>
          {(id) => (
            <Select
              id={id}
              value={reason}
              onChange={(e) => setReason(e.target.value as CustomerCancelReason)}
            >
              {CUSTOMER_CANCEL_REASONS.map((code) => (
                <option key={code} value={code}>
                  {t(`app.cancelReason.customer.${code}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label={t('app.booking.cancelNoteLabel')}
          hint={noteRequired ? t('app.booking.cancelNoteRequired') : undefined}
        >
          {(id) => (
            <TextArea
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          )}
        </Field>

        {cancel.isError ? <ErrorState error={cancel.error} /> : null}

        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            fullWidth
            disabled={cancel.isPending || (noteRequired && note.trim().length === 0)}
            onClick={() =>
              cancel.mutate({ reason, note: note.trim() || undefined }, { onSuccess: onClose })
            }
          >
            {cancel.isPending ? t('common.loading') : t('app.booking.confirmCancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
