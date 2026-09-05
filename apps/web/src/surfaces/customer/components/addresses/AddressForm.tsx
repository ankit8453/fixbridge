import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { useCreateAddress, useUpdateAddress } from '@/surfaces/customer/data/addresses';
import { ErrorState, Field, Modal, Select, TextArea, TextInput } from '@/components/ui';
import { PinIcon, ShopButton } from '@/surfaces/customer/components/notifications/shopUi';
import { MapPicker } from './MapPicker';
import type { AddressResponse, AddressLabel } from '@/surfaces/customer/data/types';

/**
 * Create/edit, landmark-first — a street address alone rarely gets a
 * technician to the right gate, a landmark does. Coordinates come **only**
 * from browser geolocation in this v1 (no map picker, no geocode-as-you-type
 * — "map-less v1") or, if the customer never grants location, the API's own
 * text-geocode fallback at save time (`docs/API.md`: "otherwise the address
 * text and landmark are geocoded"). The form says so rather than implying a
 * pin was placed. Ported from
 * `legacy-next-src/components/customer/addresses/AddressForm.tsx`.
 */
export function AddressForm({
  address,
  onClose,
}: {
  address?: AddressResponse;
  onClose: () => void;
}) {
  const t = useT();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const isEditing = Boolean(address);

  const [label, setLabel] = useState<AddressLabel>(address?.label ?? 'home');
  const [labelText, setLabelText] = useState(address?.labelText ?? '');
  const [addressText, setAddressText] = useState(address?.addressText ?? '');
  const [landmark, setLandmark] = useState(address?.landmark ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    address ? address.location : null,
  );
  const [picking, setPicking] = useState(false);

  const mutation = isEditing ? update : create;

  function handleSubmit() {
    const base = {
      label,
      labelText: labelText.trim() || undefined,
      addressText: addressText.trim(),
      landmark: landmark.trim() || undefined,
      lat: coords?.lat,
      lng: coords?.lng,
    };

    if (isEditing && address) {
      update.mutate({ addressId: address.id, input: base }, { onSuccess: onClose });
    } else {
      create.mutate(base, { onSuccess: onClose });
    }
  }

  return (
    <Modal
      title={isEditing ? t('app.addresses.editTitle') : t('app.addresses.addTitle')}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label={t('app.addresses.labelField')}>
          {(id) => (
            <Select
              id={id}
              value={label}
              onChange={(e) => setLabel(e.target.value as AddressLabel)}
            >
              <option value="home">{t('app.addresses.label.home')}</option>
              <option value="shop">{t('app.addresses.label.shop')}</option>
              <option value="other">{t('app.addresses.label.other')}</option>
            </Select>
          )}
        </Field>

        <Field label={t('app.addresses.labelTextField')}>
          {(id) => (
            <TextInput
              id={id}
              value={labelText}
              onChange={(e) => setLabelText(e.target.value)}
              maxLength={60}
            />
          )}
        </Field>

        <Field label={t('app.addresses.addressTextField')}>
          {(id) => (
            <TextArea
              id={id}
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              minLength={5}
              maxLength={500}
              required
            />
          )}
        </Field>

        <Field label={t('app.addresses.landmarkField')} hint={t('app.addresses.landmarkHint')}>
          {(id) => (
            <TextInput
              id={id}
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              maxLength={200}
            />
          )}
        </Field>

        {/* The pin. Required, not offered — the whole reason the picker exists
            is that there is no longer a path where the server has to guess,
            and leaving one open means most addresses would still take it. */}
        <div className="rounded-xl border border-shop-line bg-shop-soft/50 p-3">
          {picking ? (
            <MapPicker
              initial={coords}
              onCancel={() => setPicking(false)}
              onConfirm={(point, label) => {
                setCoords(point);
                setPicking(false);
                // The neighbourhood, as a starting point for an empty address
                // box. Never a replacement — "Surtalai" is not an address, and
                // the technician needs the house.
                if (!addressText.trim() && label) setAddressText(`${label}, `);
              }}
            />
          ) : (
            <>
              <p className="text-[12.5px] leading-snug text-shop-ink-soft">
                {coords
                  ? t('app.addresses.locationCaptured')
                  : t('app.addresses.coordsExplanation')}
              </p>
              <ShopButton tone="quiet" size="sm" className="mt-2" onClick={() => setPicking(true)}>
                <PinIcon className="h-4 w-4" />
                {coords ? t('app.addresses.changeLocation') : t('app.addresses.setOnMap')}
              </ShopButton>
            </>
          )}
        </div>

        {mutation.isError ? <ErrorState error={mutation.error} /> : null}

        <div className="flex gap-2">
          <ShopButton tone="quiet" className="flex-1" onClick={onClose}>
            {t('common.cancel')}
          </ShopButton>
          <ShopButton
            tone="primary"
            className="flex-1"
            disabled={mutation.isPending || addressText.trim().length < 5 || !coords}
            onClick={handleSubmit}
          >
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </ShopButton>
        </div>
      </div>
    </Modal>
  );
}
