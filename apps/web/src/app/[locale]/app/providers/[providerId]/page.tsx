'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useT } from '@/i18n/useT';
import { useProviderSlots, getCachedProviderCard } from '@/components/customer/data/providers';
import { ProviderHeader } from '@/components/customer/provider/ProviderHeader';
import { SlotPicker } from '@/components/customer/provider/SlotPicker';
import { ReviewsList } from '@/components/customer/provider/ReviewsList';
import { BookingModal } from '@/components/customer/provider/BookingModal';
import { QueryState, Select } from '@/components/ui';
import type { PublicSlot } from '@/components/customer/data/types';

const SLOT_WINDOW_DAYS = 7;

export default function ProviderProfilePage() {
  const t = useT();
  const { providerId } = useParams<{ providerId: string }>();
  const card = useMemo(() => getCachedProviderCard(providerId), [providerId]);

  const [categoryId, setCategoryId] = useState<number | null>(card?.skills[0]?.categoryId ?? null);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);

  const { from, to } = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getTime() + SLOT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return { from: now, to: end };
  }, []);

  const slotsQuery = useProviderSlots(providerId, from, to);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <ProviderHeader card={card} />

      {card && card.skills.length > 1 ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          {t('app.provider.serviceLabel')}
          <Select value={categoryId ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {card.skills.map((skill) => (
              <option key={skill.categoryId} value={skill.categoryId}>
                {skill.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <section>
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          {t('app.provider.availableSlots')}
        </h2>
        <QueryState
          status={slotsQuery.status}
          error={slotsQuery.error}
          data={slotsQuery.data}
          loadingLabel={t('app.provider.loadingSlots')}
          empty={{ title: t('app.provider.noSlots') }}
          isEmpty={(data) => data.slots.length === 0}
          onRetry={() => void slotsQuery.refetch()}
        >
          {(data) => (
            <SlotPicker
              slots={data.slots}
              selectedSlotId={selectedSlot?.id ?? null}
              onSelect={(slotId) =>
                setSelectedSlot(data.slots.find((s) => s.id === slotId) ?? null)
              }
            />
          )}
        </QueryState>
      </section>

      {selectedSlot && !categoryId ? (
        <p className="text-sm text-red-700">{t('app.provider.noCachedProfile')}</p>
      ) : null}

      <section>
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          {t('app.provider.reviewsHeading')}
        </h2>
        <ReviewsList providerId={providerId} />
      </section>

      {selectedSlot && categoryId ? (
        <BookingModal
          providerId={providerId}
          categoryId={categoryId}
          slot={selectedSlot}
          onClose={() => setSelectedSlot(null)}
        />
      ) : null}
    </div>
  );
}
