import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  IndianRupee,
  MapPin,
  User,
  Wrench,
} from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { QueryState } from '../../../components/ui';
import { PageHeader, Panel } from '../components/ui';
import { AvailabilityEditor } from '../components/AvailabilityEditor';
import { ChecklistCard } from '../components/ChecklistCard';
import { DocumentUploader } from '../components/DocumentUploader';
import { LocationForm } from '../components/LocationForm';
import { PriceCardsEditor } from '../components/PriceCardsEditor';
import { ProfilePhotoUploader } from '../components/ProfilePhotoUploader';
import { ProfileBasicsForm } from '../components/ProfileBasicsForm';
import { SkillsPicker } from '../components/SkillsPicker';
import { fetchMyProfile } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';

/**
 * Every section the completeness breakdown scores, on one page — a
 * technician came here from the checklist home to close a specific gap, and
 * a screen that made them hunt across five separate routes for five related
 * fields would cost more thumb-taps than the fields themselves.
 *
 * ## Layout
 *
 * Two columns from `lg` up: the sub-forms on the left, the completeness
 * checklist parked in a sticky rail on the right. The checklist is the
 * *reason* anyone is on this page, and in the old single-column stack it
 * scrolled away the moment work started — so it never got to confirm the
 * thing that had just been saved. The forms themselves stay at a readable
 * measure rather than stretching, since a 900px-wide name field is worse to
 * fill in, not better.
 */
export default function Onboarding() {
  const t = useT();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: partnerKeys.profile, queryFn: fetchMyProfile });

  return (
    <>
      <PageHeader
        title={t('partner.onboarding.title')}
        description={t('partner.onboarding.subtitle')}
      />

      <QueryState
        status={profileQuery.status}
        error={profileQuery.error}
        data={profileQuery.data}
        onRetry={() => profileQuery.refetch()}
      >
        {({ profile }) => {
          const hasPhoto = profile.documents.some((doc) => doc.docType === 'photo');

          return (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
              <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
                <Panel
                  title={t('partner.onboarding.sectionBasics')}
                  description={t('partner.onboarding.sectionBasicsHint')}
                  action={<SectionIcon icon={User} />}
                >
                  <ProfileBasicsForm profile={profile} />
                </Panel>

                <Panel
                  title={t('partner.onboarding.sectionLocation')}
                  description={t('partner.onboarding.sectionLocationHint')}
                  action={<SectionIcon icon={MapPin} />}
                >
                  <LocationForm profile={profile} />
                </Panel>

                <Panel
                  title={t('partner.onboarding.sectionSkills')}
                  description={t('partner.onboarding.sectionSkillsHint')}
                  action={<SectionIcon icon={Wrench} />}
                >
                  <SkillsPicker skills={profile.skills} />
                </Panel>

                <Panel
                  title={t('partner.onboarding.sectionPricing')}
                  description={t('partner.onboarding.sectionPricingHint')}
                  action={<SectionIcon icon={IndianRupee} />}
                >
                  <PriceCardsEditor priceCards={profile.priceCards} skills={profile.skills} />
                </Panel>

                <Panel
                  title={t('partner.onboarding.sectionAvailability')}
                  description={t('partner.onboarding.sectionAvailabilityHint')}
                  action={<SectionIcon icon={CalendarClock} />}
                >
                  <AvailabilityEditor availability={profile.availability} />
                </Panel>

                <Panel
                  title={t('partner.onboarding.sectionPhoto')}
                  description={t('partner.onboarding.photoHint')}
                  action={<SectionIcon icon={Camera} />}
                >
                  {/*
                    Two photos, deliberately, because they are two different
                    things and collapsing them is the mistake this feature
                    exists to avoid.

                    The first is the **public** one: the face a customer checks
                    against the person at their door. It is moderated, and its
                    state is shown, because until ops approves it no customer
                    sees it.

                    The second is the **KYC** one: private evidence for a
                    reviewer, never served to a customer, and what the
                    completeness score's `photoDocument` item actually counts.
                    Removing it would quietly cost the technician those points
                    with no way to earn them back.
                  */}
                  <div className="flex max-w-2xl flex-col gap-6">
                    <ProfilePhotoUploader displayName={profile.displayName} />

                    <div className="border-t border-slate-200 pt-5">
                      <p className="mb-2.5 text-sm font-medium text-slate-700">
                        {t('partner.photo.kycHeading')}
                      </p>
                      <p className="mb-3 text-xs text-slate-500">{t('partner.photo.kycHint')}</p>

                      <DocumentUploader
                        docType="photo"
                        label={t('partner.onboarding.photoUploadLabel')}
                        onUploaded={() =>
                          queryClient.invalidateQueries({ queryKey: partnerKeys.profile })
                        }
                      />

                      {hasPhoto ? (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-success">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
                          {t('partner.onboarding.photoOnFile')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Panel>
              </div>

              {/* `order-first` pulls the checklist above the forms on a
                  phone, so the reason for the page is met before the work it
                  asks for; from `lg` up the explicit grid placement puts it
                  back in column two, where it sticks beside the forms rather
                  than scrolling away above them. */}
              <aside className="order-first min-w-0 lg:order-none lg:col-start-2 lg:row-start-1 lg:sticky lg:top-20">
                <ChecklistCard completeness={profile.completeness} />
              </aside>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

/** The small tinted glyph in a section header — decoration, hidden from AT. */
function SectionIcon({ icon: Icon }: { icon: typeof User }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
      <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
    </span>
  );
}
