import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
import { Card, QueryState } from '../../../components/ui';
import { AvailabilityEditor } from '../components/AvailabilityEditor';
import { ChecklistCard } from '../components/ChecklistCard';
import { DocumentUploader } from '../components/DocumentUploader';
import { LocationForm } from '../components/LocationForm';
import { PriceCardsEditor } from '../components/PriceCardsEditor';
import { ProfileBasicsForm } from '../components/ProfileBasicsForm';
import { SkillsPicker } from '../components/SkillsPicker';
import { fetchMyProfile } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';

/**
 * Every section the completeness breakdown scores, on one page — a
 * technician came here from the checklist home to close a specific gap, and
 * a screen that made them hunt across five separate routes for five related
 * fields would cost more thumb-taps than the fields themselves.
 */
export default function Onboarding() {
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
