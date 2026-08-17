import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, useLocale } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useRaiseComplaint } from '@/surfaces/customer/data/complaints';
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from '@/surfaces/customer/data/types';
import { Button, Card, ErrorState, Field, Select, TextArea } from '@/components/ui';

/**
 * "From ARRIVED onwards" (`docs/API.md`) — before the door, a grievance is a
 * cancellation, not a complaint. `ARRIVED` itself never lingers as an
 * observed status (see `otp-display.ts`'s comment on the same fact), so in
 * practice this is IN_PROGRESS or any ending reached from it.
 */
export function canRaiseComplaint(status: string): boolean {
  return ['IN_PROGRESS', 'WORK_DONE', 'CLOSED_QUOTE_DECLINED'].includes(status);
}

/** Ported from `legacy-next-src/components/customer/bookings/ComplaintForm.tsx`. */
export function ComplaintForm({ bookingId }: { bookingId: string }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const raise = useRaiseComplaint(bookingId);

  const [category, setCategory] = useState<ComplaintCategory>('quality');
  const [description, setDescription] = useState('');

  return (
    <Card title={t('app.complaint.title')}>
      <div className="flex flex-col gap-3">
        <Field label={t('app.complaint.categoryLabel')}>
          {(id) => (
            <Select
              id={id}
              value={category}
              onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
            >
              {COMPLAINT_CATEGORIES.map((code) => (
                <option key={code} value={code}>
                  {t(`app.complaintCategory.${code}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label={t('app.complaint.descriptionLabel')}
          hint={t('app.complaint.descriptionHint')}
        >
          {(id) => (
            <TextArea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              minLength={10}
              maxLength={1000}
            />
          )}
        </Field>

        {raise.isError ? <ErrorState error={raise.error} /> : null}

        <Button
          variant="primary"
          fullWidth
          disabled={raise.isPending || description.trim().length < 10}
          onClick={() =>
            raise.mutate(
              { category, description: description.trim() },
              {
                onSuccess: () => navigate(buildLocalizedHref(locale, `/app/bookings/${bookingId}`)),
              },
            )
          }
        >
          {raise.isPending ? t('common.loading') : t('app.complaint.submit')}
        </Button>
      </div>
    </Card>
  );
}
