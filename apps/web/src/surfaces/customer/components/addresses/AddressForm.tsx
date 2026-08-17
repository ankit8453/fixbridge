import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { getCurrentLocation, GeoError, type GeoErrorReason } from '@/surfaces/customer/data/geo';
import { useCreateAddress, useUpdateAddress } from '@/surfaces/customer/data/addresses';
import { Button, ErrorState, Field, Modal, Select, TextArea, TextInput } from '@/components/ui';
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
  const [geoStatus, setGeoStatus] = useState<'idle' | 'requesting' | 'done'>('idle');
  const [geoError, setGeoError] = useState<GeoErrorReason | null>(null);

  const mutation = isEditing ? update : create;

  async function handleUseLocation() {
    setGeoStatus('requesting');
    setGeoError(null);
    try {
      const location = await getCurrentLocation();
      setCoords(location);
      setGeoStatus('done');
    } catch (err) {
      setGeoError(err instanceof GeoError ? err.reason : 'unavailable');
      setGeoStatus('idle');
    }
  }

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

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">{t('app.addresses.coordsExplanation')}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            disabled={geoStatus === 'requesting'}
            onClick={() => void handleUseLocation()}
          >
            {geoStatus === 'requesting' ? t('common.loading') : t('app.addresses.useMyLocation')}
          </Button>
          {geoStatus === 'done' && coords ? (
            <p className="mt-1 text-xs text-green-700">{t('app.addresses.locationCaptured')}</p>
          ) : null}
          {geoError ? (
            <p className="mt-1 text-xs text-red-700">{t(`app.find.geoError.${geoError}`)}</p>
          ) : null}
        </div>

        {mutation.isError ? <ErrorState error={mutation.error} /> : null}

        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            fullWidth
            disabled={mutation.isPending || addressText.trim().length < 5}
            onClick={handleSubmit}
          >
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
