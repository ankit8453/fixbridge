import { apiRequest } from '@/lib/api';
import type {
  BookingDetail,
  CategoryNode,
  NotificationsResponse,
  PaymentView,
  ProviderPriceCardResponse,
  ProviderProfileResponse,
  PublicSlot,
  QuotationView,
  TrustResponse,
  UploadUrlResponse,
  VerificationCasesResponse,
  VerificationDocumentResponse,
  WalletResponse,
} from './types';

/**
 * Every endpoint the partner surface calls, in one file — same discipline as
 * `apps/admin/src/api/endpoints.ts`: the React layer never types a URL, so a
 * pagination-parameter spelling quirk or a route move is a one-line fix here
 * instead of a grep across every screen.
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

export const updateAvailability = (
  id: string,
  input: Partial<AvailabilityInput>,
): Promise<{ profile: ProviderProfileResponse }> =>
  apiRequest(`/api/v1/providers/me/availability/${id}`, { method: 'PATCH', body: input });

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

export const listMyDocuments = (): Promise<{ documents: VerificationDocumentResponse[] }> =>
  apiRequest('/api/v1/verification/documents');

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
  input: { labourPaise: number; items: QuotationItemInput[]; note?: string },
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

export const fetchMySlots = (
  providerId: string,
  from: string,
  to: string,
): Promise<{ providerId: string; slots: PublicSlot[] }> =>
  apiRequest(`/api/v1/providers/${providerId}/slots`, { query: { from, to } });

export const blockSlot = (slotId: string): Promise<{ slot: PublicSlot; message: string }> =>
  apiRequest(`/api/v1/providers/me/slots/${slotId}/block`, { method: 'POST' });

export const unblockSlot = (slotId: string): Promise<{ slot: PublicSlot; message: string }> =>
  apiRequest(`/api/v1/providers/me/slots/${slotId}/unblock`, { method: 'POST' });

/* -------------------------------------------------------------------------- */
/* Wallet & trust                                                             */
/* -------------------------------------------------------------------------- */

export const fetchWallet = (): Promise<{ wallet: WalletResponse }> =>
  apiRequest('/api/v1/providers/me/wallet');

export const fetchTrust = (): Promise<{ trust: TrustResponse }> =>
  apiRequest('/api/v1/providers/me/trust');

/* -------------------------------------------------------------------------- */
/* Notifications                                                             */
/* -------------------------------------------------------------------------- */

export const fetchNotifications = (
  page: number,
  unreadOnly = false,
): Promise<NotificationsResponse> =>
  apiRequest('/api/v1/notifications', { query: { page, page_size: 20, unread_only: unreadOnly } });

export const fetchUnreadCount = (): Promise<{ unread: number }> =>
  apiRequest('/api/v1/notifications/unread-count');

export const markNotificationRead = (
  id: string,
): Promise<{ id: string; read: boolean; unread: number }> =>
  apiRequest(`/api/v1/notifications/${id}/read`, { method: 'POST' });

export const markAllNotificationsRead = (): Promise<{ marked: number; unread: number }> =>
  apiRequest('/api/v1/notifications/read-all', { method: 'POST' });
