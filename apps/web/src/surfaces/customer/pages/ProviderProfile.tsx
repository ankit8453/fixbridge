import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useT } from '@/i18n/useT';
import { useProviderProfile, useProviderSlots } from '@/surfaces/customer/data/providers';
import { ProviderHeader } from '@/surfaces/customer/components/provider/ProviderHeader';
import { SlotPicker } from '@/surfaces/customer/components/provider/SlotPicker';
import { ReviewsList } from '@/surfaces/customer/components/provider/ReviewsList';
import { BookingModal } from '@/surfaces/customer/components/provider/BookingModal';
import { QueryState, Select } from '@/components/ui';
import type { PublicSlot } from '@/surfaces/customer/data/types';

const SLOT_WINDOW_DAYS = 7;

/**
 * `/app/providers/:providerId` — profile, reviews, slot picker, booking
 * modal. Fetches the public profile from `GET /providers/:providerId`
 * (added in Phase 12) rather than the legacy `sessionStorage` cache of a
 * search result card, so a link forwarded on WhatsApp — a cold visit with no
 * prior search this session — renders a complete profile, not a "please go
 * back and search again" degraded state.
 */
export default function ProviderProfile() {
  const t = useT();
  const { providerId } = useParams<{ providerId: string }>();
  const id = providerId ?? '';

  const profileQuery = useProviderProfile(id);

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);

  const { from, to } = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getTime() + SLOT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return { from: now, to: end };
  }, []);

  const slotsQuery = useProviderSlots(id, from, to);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <QueryState
        status={profileQuery.status}
        error={profileQuery.error}
        data={profileQuery.data}
        loadingLabel={t('common.loading')}
        onRetry={() => void profileQuery.refetch()}
      >
        {(profile) => {
          // First render after the profile loads: default the service
          // selector to the provider's first skill, same as the legacy page.
          const effectiveCategoryId = categoryId ?? profile.skills[0]?.categoryId ?? null;

          return (
            <>
              <ProviderHeader profile={profile} />

              {profile.skills.length > 1 ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  {t('app.provider.serviceLabel')}
                  <Select
                    value={effectiveCategoryId ?? ''}
                    onChange={(e) => setCategoryId(Number(e.target.value))}
                  >
                    {profile.skills.map((skill) => (
                      <option key={skill.categoryId} value={skill.categoryId}>
                        {skill.slug}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}

              <section>
                <h2 className="mb-2 text-base font-semibold text-shop-ink">
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

              <section>
                <h2 className="mb-2 text-base font-semibold text-shop-ink">
                  {t('app.provider.reviewsHeading')}
                </h2>
                <ReviewsList providerId={id} />
              </section>

              {selectedSlot && effectiveCategoryId ? (
                <BookingModal
                  categoryId={effectiveCategoryId}
                  slot={selectedSlot}
                  onClose={() => setSelectedSlot(null)}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
