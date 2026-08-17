'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { Card } from '@/components/ui/Card';
import { QueryState } from '@/components/ui/States';
import { AvailabilityEditor } from '@/components/partner/AvailabilityEditor';
import { ChecklistCard } from '@/components/partner/ChecklistCard';
import { DocumentUploader } from '@/components/partner/DocumentUploader';
import { LocationForm } from '@/components/partner/LocationForm';
import { PriceCardsEditor } from '@/components/partner/PriceCardsEditor';
import { ProfileBasicsForm } from '@/components/partner/ProfileBasicsForm';
import { SkillsPicker } from '@/components/partner/SkillsPicker';
import { fetchMyProfile } from '@/components/partner/lib/api';
import { partnerKeys } from '@/components/partner/lib/query-keys';

/**
 * Every section the completeness breakdown scores, on one page — a
 * technician came here from the checklist home to close a specific gap, and
 * a screen that made them hunt across five separate routes for five related
 * fields would cost more thumb-taps than the fields themselves.
 */
export default function OnboardingPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: partnerKeys.profile, queryFn: fetchMyProfile });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.onboarding.title')}</h1>

      <QueryState
        status={profileQuery.status}
        error={profileQuery.error}
        data={profileQuery.data}
        onRetry={() => profileQuery.refetch()}
      >
        {({ profile }) => (
          <>
            <ChecklistCard completeness={profile.completeness} />

            <Card title={t('partner.onboarding.sectionBasics')}>
              <ProfileBasicsForm profile={profile} />
            </Card>

            <Card title={t('partner.onboarding.sectionLocation')}>
              <LocationForm profile={profile} />
            </Card>

            <Card title={t('partner.onboarding.sectionSkills')}>
              <SkillsPicker skills={profile.skills} />
            </Card>

            <Card title={t('partner.onboarding.sectionPricing')}>
              <PriceCardsEditor priceCards={profile.priceCards} skills={profile.skills} />
            </Card>

            <Card title={t('partner.onboarding.sectionAvailability')}>
              <AvailabilityEditor availability={profile.availability} />
            </Card>

            <Card title={t('partner.onboarding.sectionPhoto')}>
              <p className="mb-2 text-sm text-slate-600">{t('partner.onboarding.photoHint')}</p>
              <DocumentUploader
                docType="photo"
                label={t('partner.onboarding.photoUploadLabel')}
                onUploaded={() => queryClient.invalidateQueries({ queryKey: partnerKeys.profile })}
              />
              {profile.documents.some((doc) => doc.docType === 'photo') ? (
                <p className="mt-2 text-sm font-medium text-green-700">
                  {t('partner.onboarding.photoOnFile')}
                </p>
              ) : null}
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
