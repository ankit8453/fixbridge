import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useT } from '@/i18n/useT';
import { useProviderProfile, useProviderSlots } from '@/surfaces/customer/data/providers';
import { ProviderHeader } from '@/surfaces/customer/components/provider/ProviderHeader';
import { SlotPicker } from '@/surfaces/customer/components/provider/SlotPicker';
import { ReviewsList } from '@/surfaces/customer/components/provider/ReviewsList';
import { BookingModal } from '@/surfaces/customer/components/provider/BookingModal';
import { ClockIcon, ShieldTickIcon } from '@/surfaces/customer/components/find/TrustIcons';
import { ErrorState, Skeleton } from '@/components/ui';
import type { PublicSlot } from '@/surfaces/customer/data/types';

const SLOT_WINDOW_DAYS = 7;

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status">
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

/**
 * `/app/providers/:providerId` — profile, slots, reviews, booking modal.
 *
 * Fetches the public profile from `GET /providers/:providerId` rather than a
 * `sessionStorage` cache of a search result card, so a link forwarded on
 * WhatsApp — a cold visit with no prior search this session — renders a
 * complete profile, not a "please go back and search again" degraded state.
 *
 * ## What this page deliberately does not show
 *
 * No phone number, no address, no map, no coordinates. The API withholds all
 * of them until a booking is accepted, and the safety note under the slot
 * picker says so out loud rather than leaving the absence to be noticed — a
 * customer who understands *why* the technician's number is missing is
 * considerably less likely to go looking for it off-platform, which is the
 * whole point of the rule.
 *
 * The service selector only appears for a multi-skill technician: a select
 * with one option is a control that cannot be used.
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

  if (profileQuery.status === 'pending') {
    return (
      <div className="w-full">
        <ProfileSkeleton />
      </div>
    );
  }

  if (profileQuery.status === 'error' || profileQuery.data === undefined) {
    return (
      <div className="w-full">
        <ErrorState error={profileQuery.error} onRetry={() => void profileQuery.refetch()} />
      </div>
    );
  }

  const profile = profileQuery.data;

  // First render after the profile loads: default the service selector to the
  // provider's first skill, same as the legacy page.
  const effectiveCategoryId = categoryId ?? profile.skills[0]?.categoryId ?? null;

  return (
    <div className="flex w-full flex-col gap-4">
      <ProviderHeader profile={profile} />

      {/* ---------------- Book ---------------- */}
      <section className="overflow-hidden rounded-xl border border-shop-line bg-white">
        <div className="flex items-center gap-2.5 border-b border-shop-line px-4 py-2.5">
          <ClockIcon className="h-[18px] w-[18px] shrink-0 text-shop" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 text-[13px] font-semibold text-shop-ink">
            {t('app.provider.availableSlots')}
          </h2>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          {profile.skills.length > 1 ? (
            // Chips, not a native select: this is a two-or-three-way choice
            // and the current one should be readable without opening anything.
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-shop-ink-soft">
                {t('app.provider.serviceLabel')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {profile.skills.map((skill) => (
                  <button
                    key={skill.categoryId}
                    type="button"
                    aria-pressed={effectiveCategoryId === skill.categoryId}
                    onClick={() => setCategoryId(skill.categoryId)}
                    className={`min-h-touch rounded-xl border px-3.5 text-[13px] font-semibold transition-colors ${
                      effectiveCategoryId === skill.categoryId
                        ? 'border-shop bg-shop text-shop-foreground'
                        : 'border-shop-line bg-white text-shop-ink-soft hover:border-shop/40'
                    }`}
                  >
                    {skill.slug}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {slotsQuery.status === 'pending' ? (
            <div
              className="flex flex-wrap gap-2"
              role="status"
              aria-label={t('app.provider.loadingSlots')}
            >
              <Skeleton className="h-11 w-20 rounded-xl" />
              <Skeleton className="h-11 w-20 rounded-xl" />
              <Skeleton className="h-11 w-20 rounded-xl" />
            </div>
          ) : slotsQuery.status === 'error' || slotsQuery.data === undefined ? (
            <ErrorState error={slotsQuery.error} onRetry={() => void slotsQuery.refetch()} />
          ) : (
            <>
              <SlotPicker
                slots={slotsQuery.data.slots}
                selectedSlotId={selectedSlot?.id ?? null}
                onSelect={(slotId) =>
                  setSelectedSlot(slotsQuery.data.slots.find((s) => s.id === slotId) ?? null)
                }
              />
              {slotsQuery.data.slots.length > 0 ? (
                <p className="text-[11.5px] text-shop-ink-soft">{t('app.provider.slotHelp')}</p>
              ) : null}
            </>
          )}
        </div>

        <p className="flex items-start gap-2 border-t border-shop-line bg-shop-soft/50 px-4 py-2.5 text-[11.5px] leading-relaxed text-shop-deep">
          <ShieldTickIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('app.provider.safetyNote')}
        </p>
      </section>

      {/* ---------------- Reviews ---------------- */}
      <section>
        <h2 className="mb-2.5 text-[15px] font-bold tracking-tight text-shop-ink">
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
    </div>
  );
}
