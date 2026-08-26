import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair, Plus } from 'lucide-react';
import { useT, useLocale } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { Button, Modal } from '@/components/ui';
import { PinIcon } from './TrustIcons';
import type { ResolvedLocation } from './useResolvedLocation';
import type { AddressResponse } from '@/surfaces/customer/data/types';

const LABEL_KEYS: Record<AddressResponse['label'], string> = {
  home: 'app.addresses.label.home',
  shop: 'app.addresses.label.shop',
  other: 'app.addresses.label.other',
};

/**
 * The "where am I searching from" chip. Shared by the Find home screen and
 * the search results screen so the two never disagree about location.
 * Ported from `legacy-next-src/components/customer/find/LocationBar.tsx`.
 *
 * The `tone` prop exists because this component now renders in two very
 * different contexts: on the white body of the search results page, and (on
 * Home) directly below an indigo gradient hero. A single slate-on-slate-50 bar
 * looked like a disabled form field in the first and like a smudge in the
 * second. Rather than two components that could drift apart, one component
 * with two skins — the address-picking behaviour underneath is identical.
 *
 * Note what this never shows: the technician side of the marketplace has
 * coordinates, but this bar only ever renders the customer's *own* saved
 * address label. There is no provider location anywhere on this surface before
 * a booking is accepted, by design.
 */
export function LocationBar({
  location,
  tone = 'plain',
}: {
  location: ResolvedLocation;
  /** `plain` for a white page; `brand` for a tinted card that carries more weight. */
  tone?: 'plain' | 'brand';
}) {
  const t = useT();
  const locale = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);

  const chipText =
    location.source === 'address' && location.selectedAddress
      ? (location.selectedAddress.labelText ?? t(LABEL_KEYS[location.selectedAddress.label]))
      : location.source === 'geolocation'
        ? t('app.find.usingCurrentLocation')
        : t('app.find.noLocation');

  // The full street line under the label, when there is a saved address behind
  // the chip — a customer with "Home" and "Shop" saved cannot tell which is
  // selected from the label alone.
  const detailText =
    location.source === 'address' && location.selectedAddress
      ? location.selectedAddress.addressText
      : null;

  const shell =
    tone === 'brand' ? 'border-shop/15 bg-shop-soft' : 'border-shop-line bg-white shadow-sm';

  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 ${shell}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-shop text-shop-foreground shadow-sm">
        <PinIcon className="h-[18px] w-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-shop-ink-soft">
          {t('app.find.locationLabel')}
        </p>
        <p className="truncate text-[15px] font-bold leading-tight text-shop-ink">{chipText}</p>
        {detailText ? <p className="truncate text-xs text-shop-ink-soft">{detailText}</p> : null}
      </div>

      <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
        {t('app.find.changeLocation')}
      </Button>

      {pickerOpen ? (
        <Modal title={t('app.find.changeLocation')} onClose={() => setPickerOpen(false)}>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-shop-ink-soft">{t('app.find.locationPickerHint')}</p>

            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-shop-ink-soft">
                {t('app.find.savedAddresses')}
              </p>

              {location.addressesLoading ? (
                <p className="text-sm text-shop-ink-soft">{t('common.loading')}</p>
              ) : location.addresses.length === 0 ? (
                <p className="text-sm text-shop-ink-soft">{t('app.find.noSavedAddresses')}</p>
              ) : (
                location.addresses.map((address) => {
                  const selected = location.selectedAddress?.id === address.id;
                  return (
                    <button
                      key={address.id}
                      type="button"
                      onClick={() => {
                        location.selectAddress(address);
                        setPickerOpen(false);
                      }}
                      // `aria-pressed` rather than a colour alone: which
                      // address is active has to reach a screen reader too.
                      aria-pressed={selected}
                      className={`flex min-h-touch items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? 'border-shop bg-shop-soft'
                          : 'border-shop-line bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          selected
                            ? 'bg-shop text-shop-foreground'
                            : 'bg-slate-100 text-shop-ink-soft'
                        }`}
                      >
                        <PinIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-shop-ink">
                          {address.labelText ?? t(LABEL_KEYS[address.label])}
                        </span>
                        <span className="block truncate text-sm text-shop-ink-soft">
                          {address.addressText}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {t('app.find.orDivider')}
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <Button
              variant="secondary"
              fullWidth
              disabled={location.requestingGeo}
              loading={location.requestingGeo}
              onClick={() => {
                void location.useMyLocation().then(() => setPickerOpen(false));
              }}
            >
              {location.requestingGeo ? null : (
                <Crosshair className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
              )}
              {location.requestingGeo ? t('common.loading') : t('app.find.useMyLocation')}
            </Button>

            {location.geoError ? (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                {t(`app.find.geoError.${location.geoError}`)}
              </p>
            ) : null}

            <Link
              to={buildLocalizedHref(locale, '/app/addresses')}
              className="flex min-h-touch items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-shop hover:bg-shop-soft"
            >
              <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
              {t('app.find.manageAddresses')}
            </Link>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
