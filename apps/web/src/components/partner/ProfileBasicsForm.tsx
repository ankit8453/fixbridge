'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/i18n/useT';
import { Button } from '@/components/ui/Button';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { ErrorState } from '@/components/ui/States';
import { updateMyProfile } from './lib/api';
import { partnerKeys } from './lib/query-keys';
import type { ProviderProfileResponse } from './lib/types';

/** Name, one-line bio, years of experience — the `displayName` hard gate plus two soft-score items. */
export function ProfileBasicsForm({ profile }: { profile: ProviderProfileResponse }) {
  const t = useT();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [yearsExperience, setYearsExperience] = useState(
    profile.yearsExperience !== null ? String(profile.yearsExperience) : '',
  );

  const save = useMutation({
    mutationFn: () =>
      updateMyProfile({
        displayName: displayName.trim() || undefined,
        bio: bio.trim() === '' ? null : bio.trim(),
        yearsExperience: yearsExperience.trim() === '' ? null : Number(yearsExperience),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: partnerKeys.profile }),
  });

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('partner.basics.nameLabel')}>
        {(id) => (
          <TextInput id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        )}
      </Field>

      <Field label={t('partner.basics.bioLabel')} hint={t('partner.basics.bioHint')}>
        {(id) => (
          <TextArea id={id} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={1000} />
        )}
      </Field>

      <Field label={t('partner.basics.experienceLabel')}>
        {(id) => (
          <TextInput
            id={id}
            inputMode="numeric"
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            placeholder="5"
          />
        )}
      </Field>

      {save.isError ? <ErrorState error={save.error} onRetry={() => save.reset()} /> : null}

      <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? t('partner.common.saving') : t('partner.common.save')}
      </Button>
      {save.isSuccess ? (
        <p className="text-sm font-medium text-green-700">{t('partner.common.saved')}</p>
      ) : null}
    </div>
  );
}
