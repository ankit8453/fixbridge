'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useAddresses } from '@/components/customer/data/addresses';
import { useCreateBooking } from '@/components/customer/data/bookings';
import { istDateLabel, istDayOfWeekKey, istTime } from '@/components/customer/data/ist-date';
import { Button, ErrorState, Field, Modal, TextArea } from '@/components/ui';
import type { PublicSlot } from '@/components/customer/data/types';

const LABEL_KEYS = {
  home: 'app.addresses.label.home',
  shop: 'app.addresses.label.shop',
  other: 'app.addresses.label.other',
} as const;

export function BookingModal({
  categoryId,
  slot,
  onClose,
}: {
  /** Not read yet — the booking is created against the slot/category; kept in the
   * prop contract because the caller already has it and a future confirmation
   * screen (provider name/photo) will want it without a second fetch. */
  providerId: string;
  categoryId: number;
  slot: PublicSlot;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { data, status } = useAddresses();
  const createBooking = useCreateBooking();

  const addresses = data?.addresses ?? [];
  const [addressId, setAddressId] = useState<string | null>(
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? null,
  );
  const [problemNote, setProblemNote] = useState('');

  /**
   * `mutateAsync` **rejects** on failure — unlike `mutate`, which routes the
   * error into query state and returns void. An uncaught rejection inside an
   * async event handler surfaces as an unhandled runtime error, so the most
   * ordinary outcome in this whole flow — somebody else took the slot a second
   * before you did — crashed the page instead of showing the message.
   *
   * The rejection is swallowed here on purpose: `createBooking.isError` already
   * renders it through `ErrorState` below, which is where a person should read
   * it. Re-throwing would only reach the error boundary and lose the recovery.
   */
  async function handleConfirm() {
    if (!addressId) return;
    // A slot conflict is decided by the database, so a second click while the
    // first is still in flight is a guaranteed 409 on the same slot.
    if (createBooking.isPending) return;

    try {
      const { booking } = await createBooking.mutateAsync({
        slotId: slot.id,
        categoryId,
        addressId,
        problemNote: problemNote.trim() || undefined,
      });

      router.push(buildLocalizedHref(locale, `/app/bookings/${booking.id}`));
    } catch {
      // Rendered by ErrorState from the mutation's own state.
    }
  }

  return (
    <Modal title={t('app.provider.confirmBooking')} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-slate-700">
          {t(istDayOfWeekKey(slot.startsAt))} · {istDateLabel(slot.startsAt)} ·{' '}
          {istTime(slot.startsAt)}
        </p>

        {status === 'pending' ? (
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        ) : addresses.length === 0 ? (
          <ErrorState
            error={new Error(t('app.provider.noAddressYet'))}
            onRetry={() => router.push(buildLocalizedHref(locale, '/app/addresses'))}
          />
        ) : (
          <Field label={t('app.provider.addressLabel')}>
            {(id) => (
              <select
                id={id}
                value={addressId ?? ''}
                onChange={(e) => setAddressId(e.target.value)}
                className="w-full min-h-touch rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900"
              >
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {(address.labelText ?? t(LABEL_KEYS[address.label])) +
                      ' — ' +
                      address.addressText}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field label={t('app.provider.problemNoteLabel')} hint={t('app.provider.problemNoteHint')}>
          {(id) => (
            <TextArea
              id={id}
              value={problemNote}
              onChange={(e) => setProblemNote(e.target.value)}
              maxLength={500}
            />
          )}
        </Field>

        {createBooking.isError ? <ErrorState error={createBooking.error} /> : null}

        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            fullWidth
            disabled={!addressId || createBooking.isPending}
            onClick={() => void handleConfirm()}
          >
            {createBooking.isPending ? t('common.loading') : t('app.provider.confirmBooking')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
