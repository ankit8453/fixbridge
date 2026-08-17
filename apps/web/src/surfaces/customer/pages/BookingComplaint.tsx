import { useParams } from 'react-router-dom';
import { ComplaintForm } from '@/surfaces/customer/components/bookings/ComplaintForm';

/** `/app/bookings/:bookingId/complaint` — raise a complaint against this booking. */
export default function BookingComplaint() {
  const { bookingId } = useParams<{ bookingId: string }>();
  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <ComplaintForm bookingId={bookingId ?? ''} />
    </div>
  );
}
