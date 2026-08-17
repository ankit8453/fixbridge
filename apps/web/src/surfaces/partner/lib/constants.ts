/**
 * `BOOKING_REQUEST_TTL_MINUTES` (apps/api/src/core/config.ts, default `15`).
 *
 * The API does not put an expiry timestamp on `BookingDetail` — a REQUESTED
 * booking simply stops existing in that status once the `booking-expiry`
 * background job sweeps it (docs/bookings.md). There is no public endpoint
 * that echoes the configured TTL back to a client, so the inbox countdown
 * below is computed from `createdAt + this constant` rather than a real
 * server-supplied deadline. **This is a gap, not a guess dressed up as one**:
 * if `BOOKING_REQUEST_TTL_MINUTES` is ever changed from its default in an
 * environment, this countdown will read wrong until this constant is updated
 * to match — flagged in the phase report.
 */
export const BOOKING_REQUEST_TTL_MINUTES = 15;
