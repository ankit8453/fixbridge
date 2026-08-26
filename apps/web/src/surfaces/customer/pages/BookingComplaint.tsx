import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { ComplaintForm } from '@/surfaces/customer/components/bookings/ComplaintForm';

/**
 * `/app/bookings/:bookingId/complaint` — raise a complaint against this booking.
 *
 * The way back to the booking is an explicit link rather than a reliance on the
 * browser's back button: this page is also reached from the payment panel's
 * cash-dispute link, and somebody who has just been told they owe money they
 * did not pay should not have to guess how to get back to the evidence.
 */
export default function BookingComplaint() {
  const t = useT();
  const locale = useLocale();
  const { bookingId } = useParams<{ bookingId: string }>();
  const id = bookingId ?? '';

  return (
    <div className="flex w-full flex-col gap-3">
      <Link
        to={buildLocalizedHref(locale, `/app/bookings/${id}`)}
        className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-shop-ink-soft transition-colors hover:text-shop"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={2.25} />
        {t('app.complaint.backToBooking')}
      </Link>

      <ComplaintForm bookingId={id} />
    </div>
  );
}
