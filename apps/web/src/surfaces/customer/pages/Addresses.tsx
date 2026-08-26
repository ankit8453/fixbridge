import { useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/i18n/useT';
import {
  useAddresses,
  useDeleteAddress,
  useSetDefaultAddress,
} from '@/surfaces/customer/data/addresses';
import { AddressForm } from '@/surfaces/customer/components/addresses/AddressForm';
import { ErrorState } from '@/components/ui';
import {
  PageHeading,
  PinIcon,
  RowSkeleton,
  ShopButton,
} from '@/surfaces/customer/components/notifications/shopUi';
import type { AddressResponse } from '@/surfaces/customer/data/types';

const LABEL_KEYS = {
  home: 'app.addresses.label.home',
  shop: 'app.addresses.label.shop',
  other: 'app.addresses.label.other',
} as const;

/**
 * `/app/addresses` — geolocation + landmark-first address book, max 5.
 *
 * ## Layout
 *
 * One bordered list, one row per address, rather than a stack of separate
 * cards each carrying its own border and its own three full-size buttons.
 * Five addresses used to mean five boxes and fifteen buttons; the actions are
 * now compact icon controls on the row, still at the 44px touch floor.
 *
 * The default address sorts to the top and is the only one that gets a
 * marker, because "which address will the booking use" is the single question
 * this screen exists to answer at a glance.
 */
export default function Addresses() {
  const t = useT();
  const query = useAddresses();
  const deleteAddress = useDeleteAddress();
  const setDefault = useSetDefaultAddress();
  const [editing, setEditing] = useState<AddressResponse | 'new' | null>(null);

  const addresses = query.data?.addresses ?? [];
  const atLimit = addresses.length >= 5;

  // Sorted for display only — the API's order is untouched, and the query
  // cache is never mutated.
  const ordered = [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  return (
    <div className="flex w-full flex-col gap-3.5">
      <PageHeading
        trailing={
          <ShopButton tone="primary" size="sm" disabled={atLimit} onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
            {t('app.addresses.add')}
          </ShopButton>
        }
      >
        {t('app.addresses.title')}
      </PageHeading>

      {atLimit ? (
        <p className="text-[13px] text-shop-ink-soft">{t('app.addresses.limitReached')}</p>
      ) : null}

      {query.status === 'pending' ? <RowSkeleton rows={3} /> : null}

      {query.status === 'error' ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : null}

      {query.status === 'success' && ordered.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-shop-line bg-white/60 px-4 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-shop-soft text-shop">
            <PinIcon className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-semibold text-shop-ink">{t('app.addresses.empty')}</p>
          <p className="max-w-xs text-[13px] text-shop-ink-soft">{t('app.addresses.emptyHint')}</p>
          <ShopButton tone="primary" size="sm" className="mt-1" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
            {t('app.addresses.add')}
          </ShopButton>
        </div>
      ) : null}

      {query.status === 'success' && ordered.length > 0 ? (
        <ul className="divide-y divide-shop-line overflow-hidden rounded-2xl border border-shop-line bg-white shadow-sm">
          {ordered.map((address) => (
            <li key={address.id} className="px-4 py-3.5">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    address.isDefault ? 'bg-shop text-shop-foreground' : 'bg-shop-soft text-shop'
                  }`}
                >
                  <PinIcon className="h-[18px] w-[18px]" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-[15px] font-bold leading-tight text-shop-ink">
                      {address.labelText ?? t(LABEL_KEYS[address.label])}
                    </p>
                    {/* Default is marked with a tick as well as a tint — the
                        colour alone would not survive a greyscale screen. */}
                    {address.isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-shop-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-shop">
                        <Check className="h-3 w-3" aria-hidden="true" strokeWidth={3} />
                        {t('app.addresses.default')}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-[13.5px] leading-snug text-shop-ink-soft">
                    {address.addressText}
                  </p>
                  {address.landmark ? (
                    <p className="mt-0.5 text-[13px] leading-snug text-shop-ink-soft">
                      <span className="font-semibold">{t('app.addresses.landmarkPrefix')}:</span>{' '}
                      {address.landmark}
                    </p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {!address.isDefault ? (
                      <button
                        type="button"
                        disabled={setDefault.isPending}
                        onClick={() => setDefault.mutate(address.id)}
                        className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold text-shop transition-colors hover:bg-shop-soft disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2.5} />
                        {t('app.addresses.makeDefault')}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setEditing(address)}
                      className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold text-shop-ink-soft transition-colors hover:bg-shop-soft hover:text-shop-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2.25} />
                      {t('app.addresses.edit')}
                    </button>

                    <button
                      type="button"
                      disabled={deleteAddress.isPending}
                      onClick={() => {
                        // The confirm stays: delete is irreversible and the
                        // control sits one tap from "edit".
                        if (window.confirm(t('app.addresses.confirmDelete'))) {
                          deleteAddress.mutate(address.id);
                        }
                      }}
                      className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2.25} />
                      {t('app.addresses.delete')}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {deleteAddress.isError ? <ErrorState error={deleteAddress.error} /> : null}
      {setDefault.isError ? <ErrorState error={setDefault.error} /> : null}

      {editing ? (
        <AddressForm
          address={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
