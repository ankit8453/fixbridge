import type { BookingStatus } from './types';

/**
 * Endings that leave a bill behind — mirrors `BILLABLE_BOOKING_STATUSES` in
 * `apps/api/src/modules/bookings/state-machine.ts`. These are exactly the
 * two statuses on which the API freezes a `payablePaise`/`payable`
 * (`docs/bookings.md` "Payable, frozen at the ending"), so they are the only
 * two on which this surface ever renders a `PaymentPanel`.
 */
export const BILLABLE_STATUSES = new Set<BookingStatus>(['WORK_DONE', 'CLOSED_QUOTE_DECLINED']);
