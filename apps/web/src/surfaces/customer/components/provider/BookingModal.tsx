import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useAddresses } from '@/surfaces/customer/data/addresses';
import { useCreateBooking } from '@/surfaces/customer/data/bookings';
import { istDateLabel, istDayOfWeekKey, istTime } from '@/surfaces/customer/data/ist-date';
import { Button, ErrorState, Field, Modal, Select, TextArea } from '@/components/ui';
import type { PublicSlot } from '@/surfaces/customer/data/types';

const LABEL_KEYS = {
  home: 'app.addresses.label.home',
  shop: 'app.addresses.label.shop',
  other: 'app.addresses.label.other',
} as const;

/**
 * The confirm-and-book sheet.
 *
 * The chosen slot is restated as a bordered summary at the top rather than a
 * line of body text: it is the one fact the customer is being asked to commit
 * to, and a modal opened from a grid of near-identical time buttons has to
 * prove which one was actually tapped.
 */
export function BookingModal({
  slot,
  categoryId,
  onClose,
}: {
  categoryId: number;
  slot: PublicSlot;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
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

      navigate(buildLocalizedHref(locale, `/app/bookings/${booking.id}`));
    } catch {
      // Rendered by ErrorState from the mutation's own state.
    }
  }

  return (
    <Modal title={t('app.provider.confirmBooking')} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <div className="rounded-xl bg-shop-soft px-3.5 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-shop-deep/70">
            {t('app.provider.selectedSlotLabel')}
          </p>
          <p className="mt-0.5 text-[15px] font-bold tracking-tight text-shop-deep">
            {t(istDayOfWeekKey(slot.startsAt))}, {istDateLabel(slot.startsAt)} ·{' '}
            {istTime(slot.startsAt)}
          </p>
        </div>

        {status === 'pending' ? (
          <p className="text-sm text-shop-ink-soft">{t('common.loading')}</p>
        ) : addresses.length === 0 ? (
          <ErrorState
            error={new Error(t('app.provider.noAddressYet'))}
            onRetry={() => navigate(buildLocalizedHref(locale, '/app/addresses'))}
          />
        ) : (
          // The shared `Select`, not a hand-rolled `<select>` with its own
          // border classes — one control vocabulary, and this one already
          // enforces the 44px touch floor and 16px text.
          <Field label={t('app.provider.addressLabel')}>
            {(id) => (
              <Select
                id={id}
                value={addressId ?? ''}
                onChange={(e) => setAddressId(e.target.value)}
              >
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {(address.labelText ?? t(LABEL_KEYS[address.label])) +
                      ' — ' +
                      address.addressText}
                  </option>
                ))}
              </Select>
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
            variant="shop"
            fullWidth
            disabled={!addressId || createBooking.isPending}
            onClick={() => void handleConfirm()}
            className="border-transparent bg-shop text-shop-foreground hover:opacity-90"
          >
            {createBooking.isPending ? t('common.loading') : t('app.provider.confirmBooking')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
