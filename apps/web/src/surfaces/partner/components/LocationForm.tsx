import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field, TextInput } from '../../../components/ui';
import { updateMyProfile } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { ProviderProfileResponse } from '../lib/types';

/**
 * Base location + service radius — two of the hard-gate items in one
 * screen, since a radius means nothing without a centre point.
 *
 * `navigator.geolocation` is the only coordinate source this surface offers
 * — no map picker, same "map-less v1, honest about it" call the customer
 * surface's address book makes. A technician on a cheap Android phone almost
 * certainly has GPS; typing lat/lng by hand is the fallback for the
 * browsers/permissions that refuse it, not the primary path.
 */
export function LocationForm({ profile }: { profile: ProviderProfileResponse }) {
  const t = useT();
  const queryClient = useQueryClient();

  const [lat, setLat] = useState(profile.baseLocation ? String(profile.baseLocation.lat) : '');
  const [lng, setLng] = useState(profile.baseLocation ? String(profile.baseLocation.lng) : '');
  const [radius, setRadius] = useState(String(profile.serviceRadiusKm));
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      updateMyProfile({
        baseLocation:
          lat.trim() !== '' && lng.trim() !== ''
            ? { lat: Number(lat), lng: Number(lng) }
            : undefined,
        serviceRadiusKm: Number(radius),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: partnerKeys.profile }),
  });

  function useMyLocation() {
    setGeoError(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError(t('partner.location.geoUnsupported'));
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(String(position.coords.latitude));
        setLng(String(position.coords.longitude));
        setLocating(false);
      },
      () => {
        setGeoError(t('partner.location.geoDenied'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" onClick={useMyLocation} disabled={locating}>
        {locating ? t('partner.location.locating') : t('partner.location.useMyLocation')}
      </Button>

      {geoError ? <p className="text-sm font-medium text-danger">{geoError}</p> : null}

      {lat && lng ? (
        <p className="text-sm text-slate-600">
          {t('partner.location.captured', {
            lat: Number(lat).toFixed(4),
            lng: Number(lng).toFixed(4),
          })}
        </p>
      ) : (
        <p className="text-sm text-muted">{t('partner.location.notSet')}</p>
      )}

      <Field label={t('partner.location.radiusLabel')} hint={t('partner.location.radiusHint')}>
        {(id) => (
          <TextInput
            id={id}
            type="range"
            min={1}
            max={25}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          />
        )}
      </Field>
      <p className="text-center text-sm font-medium text-slate-700">
        {t('partner.location.radiusValue', { km: radius })}
      </p>

      {save.isError ? <ErrorState error={save.error} onRetry={() => save.reset()} /> : null}

      <Button
        variant="primary"
        disabled={save.isPending || !lat || !lng}
        onClick={() => save.mutate()}
      >
        {save.isPending ? t('partner.common.saving') : t('partner.common.save')}
      </Button>
      {save.isSuccess ? (
        <p className="text-sm font-medium text-green-700">{t('partner.common.saved')}</p>
      ) : null}
    </div>
  );
}
