import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button, ErrorState, Field, TextArea, TextInput } from '../../../components/ui';
import { updateMyProfile } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { ProviderProfileResponse } from '../lib/types';

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
    <div className="flex max-w-2xl flex-col gap-4">
      <Field label={t('partner.basics.nameLabel')}>
        {(id) => (
          <TextInput id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        )}
      </Field>

      <Field label={t('partner.basics.bioLabel')} hint={t('partner.basics.bioHint')}>
        {(id) => (
          <TextArea
            id={id}
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={1000}
          />
        )}
      </Field>

      {/* Narrower than the rest: a two-digit year count in a full-width box
          reads as though a paragraph is expected. */}
      <Field label={t('partner.basics.experienceLabel')}>
        {(id) => (
          <TextInput
            id={id}
            inputMode="numeric"
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            placeholder="5"
            className="sm:max-w-[10rem]"
          />
        )}
      </Field>

      {save.isError ? <ErrorState error={save.error} onRetry={() => save.reset()} /> : null}

      <FormActions
        pending={save.isPending}
        saved={save.isSuccess}
        onSave={() => save.mutate()}
        saveLabel={t('partner.common.save')}
        savingLabel={t('partner.common.saving')}
        savedLabel={t('partner.common.saved')}
      />
    </div>
  );
}

/**
 * The save row shared by the profile sub-forms.
 *
 * The confirmation sits beside the button rather than below it: it used to
 * push the layout down on success, which on a phone moved the button out from
 * under the thumb that had just pressed it.
 */
export function FormActions({
  pending,
  saved,
  onSave,
  saveLabel,
  savingLabel,
  savedLabel,
  disabled = false,
}: {
  pending: boolean;
  saved: boolean;
  onSave: () => void;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
      <Button variant="primary" loading={pending} disabled={disabled} onClick={onSave}>
        {pending ? savingLabel : saveLabel}
      </Button>
      {saved && !pending ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-success"
        >
          <Check className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
          {savedLabel}
        </span>
      ) : null}
    </div>
  );
}
