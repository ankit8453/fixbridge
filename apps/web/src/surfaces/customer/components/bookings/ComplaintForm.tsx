import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, useLocale } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useRaiseComplaint } from '@/surfaces/customer/data/complaints';
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from '@/surfaces/customer/data/types';
import { Button, ErrorState, Field, Select, TextArea } from '@/components/ui';
import { IconComplaint } from './BookingIcons';

/**
 * "From ARRIVED onwards" (`docs/API.md`) — before the door, a grievance is a
 * cancellation, not a complaint. `ARRIVED` itself never lingers as an
 * observed status (see `otp-display.ts`'s comment on the same fact), so in
 * practice this is IN_PROGRESS or any ending reached from it.
 */
export function canRaiseComplaint(status: string): boolean {
  return ['IN_PROGRESS', 'WORK_DONE', 'CLOSED_QUOTE_DECLINED'].includes(status);
}

/**
 * One panel, not a `Card` inside a page that is already a card-shaped column.
 * The heading is type on the page with the complaint glyph beside it; the only
 * bordered thing left is the form you actually fill in.
 */
export function ComplaintForm({ bookingId }: { bookingId: string }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const raise = useRaiseComplaint(bookingId);

  const [category, setCategory] = useState<ComplaintCategory>('quality');
  const [description, setDescription] = useState('');

  return (
    <div className="flex flex-col gap-3">
      <h1 className="flex items-center gap-2 text-[19px] font-bold tracking-tight text-shop-ink">
        <IconComplaint className="h-5 w-5 shrink-0 text-shop" aria-hidden="true" />
        {t('app.complaint.title')}
      </h1>

      <div className="flex flex-col gap-3 rounded-xl border border-shop-line bg-white p-4">
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
          variant="shop"
          fullWidth
          disabled={raise.isPending || description.trim().length < 10}
          className="border-transparent bg-shop text-shop-foreground hover:opacity-90"
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
    </div>
  );
}
