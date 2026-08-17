'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useT, useLocale } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { Button, Modal } from '@/components/ui';
import type { ResolvedLocation } from './useResolvedLocation';
import type { AddressResponse } from '@/components/customer/data/types';

const LABEL_KEYS: Record<AddressResponse['label'], string> = {
  home: 'app.addresses.label.home',
  shop: 'app.addresses.label.shop',
  other: 'app.addresses.label.other',
};

/**
 * The "where am I searching from" chip. Shared by the Find home screen and
 * the search results screen so the two never disagree about location.
 */
export function LocationBar({ location }: { location: ResolvedLocation }) {
  const t = useT();
  const locale = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);

  const chipText =
    location.source === 'address' && location.selectedAddress
      ? (location.selectedAddress.labelText ?? t(LABEL_KEYS[location.selectedAddress.label]))
      : location.source === 'geolocation'
        ? t('app.find.usingCurrentLocation')
        : t('app.find.noLocation');

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{t('app.find.locationLabel')}</p>
        <p className="truncate font-medium text-slate-900">{chipText}</p>
      </div>
      <Button variant="secondary" onClick={() => setPickerOpen(true)}>
        {t('app.find.changeLocation')}
      </Button>

      {pickerOpen ? (
        <Modal title={t('app.find.changeLocation')} onClose={() => setPickerOpen(false)}>
          <div className="flex flex-col gap-3 p-4">
            {location.addressesLoading ? (
              <p className="text-sm text-slate-500">{t('common.loading')}</p>
            ) : (
              location.addresses.map((address) => (
                <button
                  key={address.id}
                  type="button"
                  onClick={() => {
                    location.selectAddress(address);
                    setPickerOpen(false);
                  }}
                  className="min-h-touch rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium">
                    {address.labelText ?? t(LABEL_KEYS[address.label])}
                  </span>
                  <span className="block truncate text-slate-500">{address.addressText}</span>
                </button>
              ))
            )}

            <Button
              variant="secondary"
              disabled={location.requestingGeo}
              onClick={() => {
                void location.useMyLocation().then(() => setPickerOpen(false));
              }}
            >
              {location.requestingGeo ? t('common.loading') : t('app.find.useMyLocation')}
            </Button>
            {location.geoError ? (
              <p className="text-sm text-red-700">{t(`app.find.geoError.${location.geoError}`)}</p>
            ) : null}

            <Link
              href={buildLocalizedHref(locale, '/app/addresses')}
              className="min-h-touch text-center text-sm font-medium text-brand underline-offset-2 hover:underline"
            >
              {t('app.find.manageAddresses')}
            </Link>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
