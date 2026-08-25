import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crosshair, MapPin, AlertCircle } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field } from '../../../components/ui';
import { updateMyProfile } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import { FormActions } from './ProfileBasicsForm';
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

  const hasPoint = Boolean(lat && lng);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {/* The captured point, stated plainly — with no map to look at, this
          line is the only confirmation that GPS actually returned something. */}
      <div
        className={`flex items-start gap-3 rounded-xl px-4 py-3.5 ring-1 ring-inset ${
          hasPoint ? 'bg-success/5 ring-success/20' : 'bg-slate-50 ring-slate-200'
        }`}
      >
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            hasPoint
              ? 'bg-success/10 text-success'
              : 'bg-white text-slate-400 ring-1 ring-slate-200'
          }`}
        >
          <MapPin className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            {hasPoint ? t('partner.location.setTitle') : t('partner.location.notSet')}
          </p>
          {hasPoint ? (
            <p className="mt-0.5 truncate font-mono text-xs tabular-nums text-slate-500">
              {t('partner.location.captured', {
                lat: Number(lat).toFixed(4),
                lng: Number(lng).toFixed(4),
              })}
            </p>
          ) : null}
        </div>
      </div>

      <Button variant="secondary" onClick={useMyLocation} disabled={locating} fullWidth>
        <Crosshair className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
        {locating ? t('partner.location.locating') : t('partner.location.useMyLocation')}
      </Button>

      {geoError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger ring-1 ring-inset ring-danger/20"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={2.25} />
          {geoError}
        </p>
      ) : null}

      <Field label={t('partner.location.radiusLabel')} hint={t('partner.location.radiusHint')}>
        {(id) => (
          <div className="flex items-center gap-4">
            {/* Not `TextInput`: that class string paints a bordered box around
                the track, which reads as a text field rather than a slider. */}
            <input
              id={id}
              type="range"
              min={1}
              max={25}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="min-h-touch min-w-0 flex-1 cursor-pointer accent-brand"
            />
            <span className="w-20 shrink-0 rounded-lg bg-slate-100 py-1.5 text-center text-sm font-semibold tabular-nums text-slate-900">
              {t('partner.location.radiusValue', { km: radius })}
            </span>
          </div>
        )}
      </Field>

      {save.isError ? <ErrorState error={save.error} onRetry={() => save.reset()} /> : null}

      <FormActions
        pending={save.isPending}
        saved={save.isSuccess}
        // Unchanged guard: without a centre point there is nothing to save.
        disabled={!hasPoint}
        onSave={() => save.mutate()}
        saveLabel={t('partner.common.save')}
        savingLabel={t('partner.common.saving')}
        savedLabel={t('partner.common.saved')}
      />
    </div>
  );
}
