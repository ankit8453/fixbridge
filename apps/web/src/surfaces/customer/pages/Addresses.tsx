import { useState } from 'react';
import { useT } from '@/i18n/useT';
import {
  useAddresses,
  useDeleteAddress,
  useSetDefaultAddress,
} from '@/surfaces/customer/data/addresses';
import { AddressForm } from '@/surfaces/customer/components/addresses/AddressForm';
import { Badge, Button, QueryState } from '@/components/ui';
import type { AddressResponse } from '@/surfaces/customer/data/types';

const LABEL_KEYS = {
  home: 'app.addresses.label.home',
  shop: 'app.addresses.label.shop',
  other: 'app.addresses.label.other',
} as const;

/** `/app/addresses` — geolocation + landmark-first address book, max 5. */
export default function Addresses() {
  const t = useT();
  const query = useAddresses();
  const deleteAddress = useDeleteAddress();
  const setDefault = useSetDefaultAddress();
  const [editing, setEditing] = useState<AddressResponse | 'new' | null>(null);

  const atLimit = (query.data?.addresses.length ?? 0) >= 5;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-shop-ink">{t('app.addresses.title')}</h1>
        <Button variant="primary" disabled={atLimit} onClick={() => setEditing('new')}>
          {t('app.addresses.add')}
        </Button>
      </div>
      {atLimit ? (
        <p className="text-xs text-shop-ink-soft">{t('app.addresses.limitReached')}</p>
      ) : null}

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel={t('common.loading')}
        empty={{ title: t('app.addresses.empty'), hint: t('app.addresses.emptyHint') }}
        isEmpty={(data) => data.addresses.length === 0}
        onRetry={() => void query.refetch()}
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            {data.addresses.map((address) => (
              <div key={address.id} className="rounded-xl border border-shop-line bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-shop-ink">
                    {address.labelText ?? t(LABEL_KEYS[address.label])}
                  </p>
                  {address.isDefault ? (
                    <Badge tone="success">{t('app.addresses.default')}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-700">{address.addressText}</p>
                {address.landmark ? (
                  <p className="text-sm text-shop-ink-soft">
                    {t('app.addresses.landmarkPrefix')}: {address.landmark}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setEditing(address)}>
                    {t('app.addresses.edit')}
                  </Button>
                  {!address.isDefault ? (
                    <Button
                      variant="secondary"
                      disabled={setDefault.isPending}
                      onClick={() => setDefault.mutate(address.id)}
                    >
                      {t('app.addresses.makeDefault')}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    disabled={deleteAddress.isPending}
                    onClick={() => {
                      if (window.confirm(t('app.addresses.confirmDelete'))) {
                        deleteAddress.mutate(address.id);
                      }
                    }}
                  >
                    {t('app.addresses.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </QueryState>

      {editing ? (
        <AddressForm
          address={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
