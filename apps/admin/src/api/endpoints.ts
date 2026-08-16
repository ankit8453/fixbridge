import { apiRequest, toPage, type Page } from '../lib/api';
import type {
  AdminSummary,
  AuditRow,
  AuthSession,
  BookingRow,
  BookingTimelineResponse,
  Complaint,
  CreateBatchResult,
  DeliveryRow,
  JournalDetail,
  JournalRow,
  OutboxRow,
  PayoutBatchDetail,
  PayoutBatchRow,
  ProviderDetail,
  ProviderRow,
  ReviewReport,
  VerificationCaseDetail,
  VerificationQueueRow,
  WebhookRow,
} from './types';

/**
 * Every endpoint this console calls, in one file.
 *
 * The React layer never types a URL. That is not tidiness — the API's list
 * endpoints disagree about pagination parameter names (`pageSize` on Phase 4's
 * verification queue, `page_size` on the Phase 9 and 11 modules, because their
 * Zod schemas are `.strict()` and reject the other spelling with a 400). Keeping
 * that disagreement in one file means it is a documented quirk here rather than
 * a mystery 400 in six different components.
 */

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

export const requestOtp = (phone: string): Promise<{ expiresInSeconds: number }> =>
  apiRequest('/api/v1/auth/otp/request', {
    method: 'POST',
    body: { phone },
    skipAuth: true,
  });

export const verifyOtp = (phone: string, otp: string, deviceId: string): Promise<AuthSession> =>
  apiRequest('/api/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone, otp, deviceId },
    skipAuth: true,
  });

export const logoutSession = (refreshToken: string): Promise<{ message: string }> =>
  apiRequest('/api/v1/auth/logout', { method: 'POST', body: { refreshToken }, skipAuth: true });

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export const fetchSummary = (): Promise<AdminSummary> => apiRequest('/api/v1/admin/summary');

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

export interface VerificationQueueFilters {
  status?: string;
  level?: string;
  page: number;
}

export async function fetchVerificationQueue(
  filters: VerificationQueueFilters,
): Promise<Page<VerificationQueueRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/verification/queue', {
    query: {
      status: filters.status,
      level: filters.level,
      page: filters.page,
      // Phase 4's schema. Sending `page_size` here is a 400, not a default.
      pageSize: 20,
    },
  });

  return toPage<VerificationQueueRow>(body, 'cases');
}

export const fetchVerificationCase = (caseId: string): Promise<VerificationCaseDetail> =>
  apiRequest(`/api/v1/admin/verification/cases/${caseId}`);

export const reviewVerificationCase = (caseId: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/verification/cases/${caseId}/review`, { method: 'POST', body: {} });

export const decideVerificationCase = (
  caseId: string,
  input: { decision: 'pass' | 'fail' | 'request_info'; notes?: string },
): Promise<unknown> =>
  apiRequest(`/api/v1/admin/verification/cases/${caseId}/decide`, { method: 'POST', body: input });

/* -------------------------------------------------------------------------- */
/* Providers and users                                                        */
/* -------------------------------------------------------------------------- */

export interface ProviderFilters {
  q?: string;
  city_id?: string;
  badge?: string;
  listed?: string;
  suspended?: string;
  pending_approval?: string;
  page: number;
}

export async function fetchProviders(filters: ProviderFilters): Promise<Page<ProviderRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/providers', {
    query: { ...filters, page_size: 20 },
  });

  return toPage<ProviderRow>(body, 'providers');
}

export const fetchProvider = (providerId: string): Promise<{ provider: ProviderDetail }> =>
  apiRequest(`/api/v1/admin/providers/${providerId}`);

export const suspendProvider = (input: {
  providerId: string;
  reason: string;
  days?: number;
}): Promise<unknown> => apiRequest('/api/v1/admin/trust/suspend', { method: 'POST', body: input });

export const reinstateProvider = (providerId: string, reason: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/trust/${providerId}/reinstate`, { method: 'POST', body: { reason } });

export const approveProviderEntry = (providerId: string, note: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/providers/${providerId}/approve-entry`, {
    method: 'POST',
    body: { note },
  });

export const blockUser = (userId: string, reason: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/users/${userId}/block`, { method: 'POST', body: { reason } });

export const unblockUser = (userId: string, reason: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/users/${userId}/unblock`, { method: 'POST', body: { reason } });

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

export interface BookingFilters {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  page: number;
}

export async function fetchBookings(filters: BookingFilters): Promise<Page<BookingRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/bookings', {
    query: { ...filters, page_size: 20 },
  });

  return toPage<BookingRow>(body, 'bookings');
}

export const fetchBookingTimeline = (bookingId: string): Promise<BookingTimelineResponse> =>
  apiRequest(`/api/v1/admin/bookings/${bookingId}/timeline`);

export const unlockBookingOtp = (
  bookingId: string,
  input: { note: string; kind: 'start' | 'end' | 'both' },
): Promise<{ codes?: { start: string | null; end: string | null } }> =>
  apiRequest(`/api/v1/admin/bookings/${bookingId}/otp-unlock`, { method: 'POST', body: input });

export const opsCancelBooking = (bookingId: string, reason: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason } });

/* -------------------------------------------------------------------------- */
/* Complaints                                                                 */
/* -------------------------------------------------------------------------- */

export async function fetchComplaints(filters: {
  status?: string;
  page: number;
}): Promise<Page<Complaint>> {
  const body = await apiRequest<unknown>('/api/v1/admin/complaints', {
    query: { status: filters.status, page: filters.page, page_size: 20 },
  });

  return toPage<Complaint>(body, 'complaints');
}

/** Ops read a single complaint through the shared route — the service lets them. */
export const fetchComplaint = (complaintId: string): Promise<{ complaint: Complaint }> =>
  apiRequest(`/api/v1/complaints/${complaintId}`);

export const takeUpComplaint = (complaintId: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/complaints/${complaintId}/take-up`, { method: 'POST', body: {} });

export const resolveComplaint = (
  complaintId: string,
  input: { note: string; severity: 'minor' | 'major' | 'severe' },
): Promise<unknown> =>
  apiRequest(`/api/v1/admin/complaints/${complaintId}/resolve`, { method: 'POST', body: input });

export const dismissComplaint = (complaintId: string, note: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/complaints/${complaintId}/dismiss`, { method: 'POST', body: { note } });

/* -------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchReviewReports(filters: { page: number }): Promise<Page<ReviewReport>> {
  const body = await apiRequest<unknown>('/api/v1/admin/reviews/reports', {
    query: { page: filters.page, page_size: 20 },
  });

  return toPage<ReviewReport>(body, 'reports');
}

export const hideReview = (reviewId: string, hidden: boolean): Promise<unknown> =>
  apiRequest(`/api/v1/admin/reviews/${reviewId}/${hidden ? 'hide' : 'unhide'}`, {
    method: 'POST',
    body: {},
  });

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The batch **list** lives on the admin module; every batch **mutation** lives
 * with payments under `/admin/payments`. Not a mistake to tidy up — the
 * lifecycle belongs to the module that owns the ledger, and the list is just a
 * read for the console.
 */
export async function fetchPayoutBatches(filters: { page: number }): Promise<Page<PayoutBatchRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/payout-batches', {
    query: { page: filters.page, page_size: 20 },
  });

  return toPage<PayoutBatchRow>(body, 'batches');
}

export const createPayoutBatch = (): Promise<CreateBatchResult> =>
  apiRequest('/api/v1/admin/payments/payout-batches', { method: 'POST', body: {} });

export const fetchPayoutBatch = (batchId: string): Promise<{ batch: PayoutBatchDetail }> =>
  apiRequest(`/api/v1/admin/payments/payout-batches/${batchId}`);

export const closePayoutBatch = (batchId: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/payments/payout-batches/${batchId}/close`, {
    method: 'POST',
    body: {},
  });

export const markPayoutPaid = (payoutId: string, utrRef: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/payments/payouts/${payoutId}/paid`, {
    method: 'POST',
    body: { utrRef },
  });

export const markPayoutFailed = (payoutId: string, note: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/payments/payouts/${payoutId}/failed`, {
    method: 'POST',
    body: { note },
  });

export const settleDues = (input: {
  providerId: string;
  amountPaise: number;
  memo: string;
}): Promise<unknown> =>
  apiRequest('/api/v1/admin/payments/dues/settle', { method: 'POST', body: input });

export interface JournalFilters {
  journal_type?: string;
  booking_id?: string;
  provider_id?: string;
  page: number;
}

export async function fetchJournals(filters: JournalFilters): Promise<Page<JournalRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/ledger/journals', {
    query: { ...filters, page_size: 20 },
  });

  return toPage<JournalRow>(body, 'journals');
}

export const fetchJournal = (journalId: string): Promise<{ journal: JournalDetail }> =>
  apiRequest(`/api/v1/admin/ledger/journals/${journalId}`);

/* -------------------------------------------------------------------------- */
/* Parked queues                                                              */
/* -------------------------------------------------------------------------- */

export async function fetchParkedOutbox(page: number): Promise<Page<OutboxRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/queues/outbox', {
    query: { page, page_size: 20 },
  });

  return toPage<OutboxRow>(body, 'events');
}

export async function fetchParkedWebhooks(page: number): Promise<Page<WebhookRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/queues/webhooks', {
    query: { page, page_size: 20 },
  });

  return toPage<WebhookRow>(body, 'webhooks');
}

export async function fetchParkedDeliveries(page: number): Promise<Page<DeliveryRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/queues/deliveries', {
    query: { page, page_size: 20 },
  });

  return toPage<DeliveryRow>(body, 'deliveries');
}

export const retryOutbox = (id: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/queues/outbox/${id}/retry`, { method: 'POST', body: {} });

export const discardOutbox = (id: string, reason: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/queues/outbox/${id}/discard`, { method: 'POST', body: { reason } });

export const reprocessWebhook = (id: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/queues/webhooks/${id}/reprocess`, { method: 'POST', body: {} });

export const discardWebhook = (id: string, reason: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/queues/webhooks/${id}/discard`, { method: 'POST', body: { reason } });

export const retryDelivery = (id: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/queues/deliveries/${id}/retry`, { method: 'POST', body: {} });

export const discardDelivery = (id: string, reason: string): Promise<unknown> =>
  apiRequest(`/api/v1/admin/queues/deliveries/${id}/discard`, { method: 'POST', body: { reason } });

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export interface AuditFilters {
  actor_user_id?: string;
  action?: string;
  target_type?: string;
  target_id?: string;
  from?: string;
  to?: string;
  page: number;
}

export async function fetchAuditLogs(filters: AuditFilters): Promise<Page<AuditRow>> {
  const body = await apiRequest<unknown>('/api/v1/admin/audit-logs', {
    query: { ...filters, page_size: 20 },
  });

  return toPage<AuditRow>(body, 'entries');
}
