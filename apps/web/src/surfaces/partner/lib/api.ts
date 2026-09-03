import { apiRequest } from '../../../lib/api';
import type {
  BookingDetail,
  CategoryNode,
  NotificationsResponse,
  OwnSlot,
  PaymentView,
  PayoutDetailInput,
  PayoutDetailResponse,
  PhotoUploadUrlResponse,
  ProfilePhoto,
  ProviderPriceCardResponse,
  ProviderProfileResponse,
  QuotationView,
  TrustResponse,
  UploadUrlResponse,
  VerificationCasesResponse,
  VerificationDocumentResponse,
  WalletResponse,
} from './types';

/**
 * Every endpoint the partner surface calls, in one file — ported from
 * `legacy-next-src/components/partner/lib/api.ts`: the React layer never
 * types a URL, so a pagination-parameter spelling quirk or a route move is a
 * one-line fix here instead of a grep across every screen.
 */

/* -------------------------------------------------------------------------- */
/* Registration & profile — /api/v1/providers                                 */
/* -------------------------------------------------------------------------- */

export const registerProvider = (
  displayName?: string,
): Promise<{
  profile: ProviderProfileResponse;
  alreadyRegistered: boolean;
}> => apiRequest('/api/v1/providers/me/register', { method: 'POST', body: { displayName } });

export const fetchMyProfile = (): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest('/api/v1/providers/me');

export const updateMyProfile = (input: {
  displayName?: string;
  bio?: string | null;
  yearsExperience?: number | null;
  serviceRadiusKm?: number;
  baseLocation?: { lat: number; lng: number };
}): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest('/api/v1/providers/me', { method: 'PATCH', body: input });

/* ---- profile photo ---- */

/**
 * The public-facing photo, which does **not** go through the KYC document
 * endpoints — separate store, opposite privacy posture. Same three-step signed
 * URL flow, so the bytes still never touch our API.
 */
export const requestPhotoUploadUrl = (input: {
  contentType: string;
  sizeBytes: number;
}): Promise<PhotoUploadUrlResponse> =>
  apiRequest('/api/v1/providers/me/photo/upload-url', { method: 'POST', body: input });

export const confirmPhotoUpload = (
  photoId: string,
): Promise<{ photo: ProfilePhoto; message: string }> =>
  apiRequest(`/api/v1/providers/me/photo/${photoId}/confirm`, { method: 'POST' });

/** Null when the technician has never uploaded one. */
export const fetchMyPhoto = (): Promise<{ photo: ProfilePhoto | null }> =>
  apiRequest('/api/v1/providers/me/photo');

export const addSkill = (
  categoryId: number,
  experienceNote?: string,
): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest('/api/v1/providers/me/skills', {
    method: 'POST',
    body: { categoryId, experienceNote },
  });

export const removeSkill = (categoryId: number): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest(`/api/v1/providers/me/skills/${categoryId}`, { method: 'DELETE' });

export interface PriceCardInput {
  categoryId: number;
  title: string;
  priceType: ProviderPriceCardResponse['priceType'];
  amountPaise?: number;
  isActive?: boolean;
}

export const createPriceCard = (
  input: PriceCardInput,
): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest('/api/v1/providers/me/price-cards', { method: 'POST', body: input });

export const updatePriceCard = (
  id: string,
  input: Partial<PriceCardInput>,
): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest(`/api/v1/providers/me/price-cards/${id}`, { method: 'PATCH', body: input });

export const deletePriceCard = (id: string): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest(`/api/v1/providers/me/price-cards/${id}`, { method: 'DELETE' });

export interface AvailabilityInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive?: boolean;
}

export const createAvailability = (
  input: AvailabilityInput,
): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest('/api/v1/providers/me/availability', { method: 'POST', body: input });

export const deleteAvailability = (id: string): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest(`/api/v1/providers/me/availability/${id}`, { method: 'DELETE' });

/* -------------------------------------------------------------------------- */
/* Categories — public, used for the skills picker                            */
/* -------------------------------------------------------------------------- */

export const fetchCategories = (
  cityId = 1,
): Promise<{ cityId: number; categories: CategoryNode[] }> =>
  apiRequest('/api/v1/categories', { query: { cityId }, skipAuth: true });

/* -------------------------------------------------------------------------- */
/* Verification — /api/v1/verification                                       */
/* -------------------------------------------------------------------------- */

export const requestUploadUrl = (input: {
  docType: 'id_proof' | 'certificate' | 'photo' | 'other';
  contentType: string;
  sizeBytes: number;
}): Promise<UploadUrlResponse> =>
  apiRequest('/api/v1/verification/documents/upload-url', { method: 'POST', body: input });

export const confirmUpload = (
  documentId: string,
): Promise<{ document: VerificationDocumentResponse; message: string }> =>
  apiRequest(`/api/v1/verification/documents/${documentId}/confirm`, { method: 'POST' });

export const submitLevel = (
  level: number,
  body: unknown,
): Promise<{ case: unknown; message: string }> =>
  apiRequest(`/api/v1/verification/levels/${level}/submit`, { method: 'POST', body });

export const fetchMyCases = (): Promise<VerificationCasesResponse> =>
  apiRequest('/api/v1/verification/cases');

export const provideInfo = (
  caseId: string,
  notes: string,
  documentIds?: string[],
): Promise<{ case: unknown; message: string }> =>
  apiRequest(`/api/v1/verification/cases/${caseId}/info`, {
    method: 'POST',
    body: { notes, documentIds },
  });

/* -------------------------------------------------------------------------- */
/* Bookings & slots — /api/v1/bookings, /api/v1/providers                     */
/* -------------------------------------------------------------------------- */

export const listMyBookings = (
  side: 'provider' = 'provider',
): Promise<{ bookings: BookingDetail[] }> => apiRequest('/api/v1/bookings', { query: { side } });

export const fetchBooking = (bookingId: string): Promise<{ booking: BookingDetail }> =>
  apiRequest(`/api/v1/bookings/${bookingId}`);

export const acceptBooking = (bookingId: string): Promise<{ booking: BookingDetail }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/accept`, { method: 'POST' });

export const rejectBooking = (
  bookingId: string,
  reason: string,
  note?: string,
): Promise<{ booking: BookingDetail }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/reject`, { method: 'POST', body: { reason, note } });

export const markEnRoute = (bookingId: string): Promise<{ booking: BookingDetail }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/en-route`, { method: 'POST' });

export const submitStartOtp = (
  bookingId: string,
  otp: string,
): Promise<{ booking: BookingDetail }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/start`, { method: 'POST', body: { otp } });

export const submitEndOtp = (bookingId: string, otp: string): Promise<{ booking: BookingDetail }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/complete`, { method: 'POST', body: { otp } });

export const cancelBooking = (
  bookingId: string,
  reason: string,
  note?: string,
): Promise<{ booking: BookingDetail }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason, note } });

export interface QuotationItemInput {
  kind: 'part' | 'labour_extra';
  description: string;
  qty: number;
  unitPaise: number;
}

export const sendQuotation = (
  bookingId: string,
  input: {
    labourPaise: number;
    /** The booked rate, echoed back so the server never has to infer the split. */
    agreedLabourPaise?: number;
    extraLabourPaise?: number;
    extraLabourReason?: string;
    items: QuotationItemInput[];
    note?: string;
  },
): Promise<{ quotation: QuotationView }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/quotations`, { method: 'POST', body: input });

export const withdrawQuotation = (quotationId: string): Promise<{ quotation: QuotationView }> =>
  apiRequest(`/api/v1/quotations/${quotationId}/withdraw`, { method: 'POST' });

export const fetchBookingPayments = (
  bookingId: string,
): Promise<{ bookingId: string; payments: PaymentView[] }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/payments`);

export const recordCashCollected = (
  bookingId: string,
  note?: string,
): Promise<{ payment: unknown; message: string }> =>
  apiRequest(`/api/v1/bookings/${bookingId}/payments/cash`, { method: 'POST', body: { note } });

/**
 * The technician's own week — `GET /api/v1/providers/me/slots?from=&to=`,
 * added this phase (`apps/api/src/modules/bookings/routes.ts`
 * `providerSlotRouter`). Distinct from the legacy Next app's reference
 * (`fetchMySlots`, which called the public `/providers/:id/slots` and could
 * only ever see `open` hours): this owner-scoped endpoint returns the
 * technician's own blocked/booked slots too, which is what lets `/slots`
 * show — and un-block — a slot blocked in an earlier visit instead of only
 * the current browser session's own writes.
 */
export const fetchMySlots = (from: string, to: string): Promise<{ slots: OwnSlot[] }> =>
  apiRequest('/api/v1/providers/me/slots', { query: { from, to } });

export const blockSlot = (slotId: string): Promise<{ slot: OwnSlot; message: string }> =>
  apiRequest(`/api/v1/providers/me/slots/${slotId}/block`, { method: 'POST' });

export const unblockSlot = (slotId: string): Promise<{ slot: OwnSlot; message: string }> =>
  apiRequest(`/api/v1/providers/me/slots/${slotId}/unblock`, { method: 'POST' });

/* -------------------------------------------------------------------------- */
/* Wallet & trust                                                             */
/* -------------------------------------------------------------------------- */

export const fetchWallet = (): Promise<{ wallet: WalletResponse }> =>
  apiRequest('/api/v1/providers/me/wallet');

export const fetchTrust = (): Promise<{ trust: TrustResponse }> =>
  apiRequest('/api/v1/providers/me/trust');

/**
 * `payoutDetail` is null when nothing has been saved — a 200, not a 404.
 * A technician who has not been paid yet has legitimately never seen the form.
 */
export const fetchPayoutDetail = (): Promise<{ payoutDetail: PayoutDetailResponse | null }> =>
  apiRequest('/api/v1/providers/me/payout-details');

/** A full replace: switching bank to UPI must not leave the old account behind. */
export const savePayoutDetail = (
  input: PayoutDetailInput,
): Promise<{ payoutDetail: PayoutDetailResponse }> =>
  apiRequest('/api/v1/providers/me/payout-details', { method: 'PUT', body: input });

/* -------------------------------------------------------------------------- */
/* Notifications                                                             */
/* -------------------------------------------------------------------------- */

export const fetchNotifications = (
  page: number,
  unreadOnly = false,
): Promise<NotificationsResponse> =>
  apiRequest('/api/v1/notifications', { query: { page, page_size: 20, unread_only: unreadOnly } });

export const markNotificationRead = (
  id: string,
): Promise<{ id: string; read: boolean; unread: number }> =>
  apiRequest(`/api/v1/notifications/${id}/read`, { method: 'POST' });

export const markAllNotificationsRead = (): Promise<{ marked: number; unread: number }> =>
  apiRequest('/api/v1/notifications/read-all', { method: 'POST' });
