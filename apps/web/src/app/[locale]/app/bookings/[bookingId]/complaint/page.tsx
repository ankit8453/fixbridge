'use client';

import { useParams } from 'next/navigation';
import { ComplaintForm } from '@/components/customer/bookings/ComplaintForm';

export default function BookingComplaintPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <ComplaintForm bookingId={bookingId} />
    </div>
  );
}
