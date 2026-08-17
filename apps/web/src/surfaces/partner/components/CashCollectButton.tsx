import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Modal } from '../../../components/ui';
import { formatPaise } from '../../../lib/money';
import { recordCashCollected } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';

/**
 * "Cash collected" — the one thing a technician can do unilaterally about
 * money, so the API sends the customer a notification the moment it happens
 * (docs/API.md). The confirmation step here exists for the same reason: a
 * mis-tap that records the wrong amount is not something either side can
 * quietly undo afterwards.
 */
export function CashCollectButton({
  bookingId,
  amountPaise,
}: {
  bookingId: string;
  amountPaise: number;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: () => recordCashCollected(bookingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partnerKeys.booking(bookingId) });
      queryClient.invalidateQueries({ queryKey: partnerKeys.wallet });
      setConfirming(false);
    },
  });

  return (
    <>
      <Button variant="primary" fullWidth onClick={() => setConfirming(true)}>
        {t('partner.job.cashCollectButton')}
      </Button>

      {confirming ? (
        <Modal title={t('partner.job.cashConfirmTitle')} onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4 p-4">
            <p className="text-center text-3xl font-bold tabular-nums text-slate-900">
              {formatPaise(amountPaise)}
            </p>
            <p className="text-center text-sm text-slate-600">{t('partner.job.cashConfirmHint')}</p>

            {mutation.isError ? (
              <ErrorState error={mutation.error} onRetry={() => mutation.reset()} />
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setConfirming(false)}
                disabled={mutation.isPending}
              >
                {t('partner.common.cancel')}
              </Button>
              <Button
                variant="primary"
                fullWidth
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending
                  ? t('partner.job.cashConfirming')
                  : t('partner.job.cashConfirm')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
