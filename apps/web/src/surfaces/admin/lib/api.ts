import { apiRequest, paginationParams, parsePage, type Page, type RequestOptions } from '@/lib/api';
import type {
  AdminSummary,
  AuditRow,
  AuditScope,
  BookingRow,
  BookingTimelineResponse,
  Complaint,
  CouponRow,
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
 * Every `/admin` endpoint this surface calls, in one file — ported from
 * `legacy-next-src/components/admin/lib/api.ts`. Every call goes through
 * `adminRequest`, which pins `Accept-Language` to `en` regardless of which
 * locale segment the visitor arrived from — this surface stays English-only
 * by design (see apps/web/README.md and the phase brief), and that decision
 * is one option on the shared client, not a standalone fetch wrapper.
 *
 * The API's list endpoints still disagree about pagination parameter names
 * (`pageSize` on the verification queue, `page_size` everywhere else,
 * because their Zod schemas are `.strict()` and reject the other spelling
 * with a 400) — `paginationParams()` from `@/lib/api` is the one place that
 * disagreement is spelled out; every call below just states which spelling
 * it needs.
 */

function adminRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { ...options, locale: 'en' });
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export const fetchSummary = (): Promise<AdminSummary> => adminRequest('/api/v1/admin/summary');

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

export interface VerificationQueueFilters {
  status?: string;
  level?: string;
  cityId?: string;
  page: number;
}

export async function fetchVerificationQueue(
  filters: VerificationQueueFilters,
): Promise<Page<VerificationQueueRow>> {
  const body = await adminRequest<unknown>('/api/v1/admin/verification/queue', {
    query: {
      status: filters.status,
      level: filters.level,
      cityId: filters.cityId,
      // This endpoint's schema takes `pageSize`. Sending `page_size` here is
      // a 400, not a default.
      ...paginationParams(filters.page, 20, 'pageSize'),
    },
  });

  return parsePage<VerificationQueueRow>(body, 'cases');
}

export const fetchVerificationCase = (caseId: string): Promise<VerificationCaseDetail> =>
  adminRequest(`/api/v1/admin/verification/cases/${caseId}`);

export const reviewVerificationCase = (caseId: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/verification/cases/${caseId}/review`, { method: 'POST', body: {} });

export const decideVerificationCase = (
  caseId: string,
  input: { decision: 'pass' | 'fail' | 'request_info'; notes?: string },
): Promise<unknown> =>
  adminRequest(`/api/v1/admin/verification/cases/${caseId}/decide`, {
    method: 'POST',
    body: input,
  });

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
  const body = await adminRequest<unknown>('/api/v1/admin/providers', {
    query: { ...filters, ...paginationParams(filters.page, 20) },
  });

  return parsePage<ProviderRow>(body, 'providers');
}

export const fetchProvider = (providerId: string): Promise<{ provider: ProviderDetail }> =>
  adminRequest(`/api/v1/admin/providers/${providerId}`);

export const suspendProvider = (input: {
  providerId: string;
  reason: string;
  days?: number;
}): Promise<unknown> =>
  adminRequest('/api/v1/admin/trust/suspend', { method: 'POST', body: input });

export const reinstateProvider = (providerId: string, reason: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/trust/${providerId}/reinstate`, { method: 'POST', body: { reason } });

/**
 * Approving a provider's entry into a city that requires it. NOT in the
 * backend's `ADMIN_ONLY_ROUTES` (`apps/api/src/core/audit.ts`) — that list
 * covers the *city's* `require_entry_approval` config flag
 * (`PATCH /admin/cities/:cityId`), which this surface does not expose at
 * all (no city-config screen exists in the legacy console either). This
 * per-provider approval stays judgment work ops may do.
 */
export const approveProviderEntry = (providerId: string, note: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/providers/${providerId}/approve-entry`, {
    method: 'POST',
    body: { note },
  });

export const blockUser = (userId: string, reason: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/users/${userId}/block`, { method: 'POST', body: { reason } });

export const unblockUser = (userId: string, reason: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/users/${userId}/unblock`, { method: 'POST', body: { reason } });

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
  const body = await adminRequest<unknown>('/api/v1/admin/bookings', {
    query: { ...filters, ...paginationParams(filters.page, 20) },
  });

  return parsePage<BookingRow>(body, 'bookings');
}

export const fetchBookingTimeline = (bookingId: string): Promise<BookingTimelineResponse> =>
  adminRequest(`/api/v1/admin/bookings/${bookingId}/timeline`);

export const unlockBookingOtp = (
  bookingId: string,
  input: { note: string; kind: 'start' | 'end' | 'both' },
): Promise<{ codes?: { start: string | null; end: string | null } }> =>
  adminRequest(`/api/v1/admin/bookings/${bookingId}/otp-unlock`, { method: 'POST', body: input });

export const opsCancelBooking = (bookingId: string, reason: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason } });

/* -------------------------------------------------------------------------- */
/* Complaints                                                                 */
/* -------------------------------------------------------------------------- */

export async function fetchComplaints(filters: {
  status?: string;
  page: number;
}): Promise<Page<Complaint>> {
  const body = await adminRequest<unknown>('/api/v1/admin/complaints', {
    query: { status: filters.status, ...paginationParams(filters.page, 20) },
  });

  return parsePage<Complaint>(body, 'complaints');
}

/** Ops read a single complaint through the shared route — the service lets them. */
export const fetchComplaint = (complaintId: string): Promise<{ complaint: Complaint }> =>
  adminRequest(`/api/v1/complaints/${complaintId}`);

export const takeUpComplaint = (complaintId: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/complaints/${complaintId}/take-up`, { method: 'POST', body: {} });

export const resolveComplaint = (
  complaintId: string,
  input: { note: string; severity: 'minor' | 'major' | 'severe' },
): Promise<unknown> =>
  adminRequest(`/api/v1/admin/complaints/${complaintId}/resolve`, { method: 'POST', body: input });

export const dismissComplaint = (complaintId: string, note: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/complaints/${complaintId}/dismiss`, {
    method: 'POST',
    body: { note },
  });

/* -------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchReviewReports(filters: { page: number }): Promise<Page<ReviewReport>> {
  const body = await adminRequest<unknown>('/api/v1/admin/reviews/reports', {
    query: paginationParams(filters.page, 20),
  });

  return parsePage<ReviewReport>(body, 'reports');
}

export const hideReview = (reviewId: string, hidden: boolean): Promise<unknown> =>
  adminRequest(`/api/v1/admin/reviews/${reviewId}/${hidden ? 'hide' : 'unhide'}`, {
    method: 'POST',
    body: {},
  });

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The batch **list** lives on the admin module; every batch **mutation** lives
 * with payments under `/admin/payments`. Not a mistake to tidy up — the
 * lifecycle belongs to the module that owns the ledger, and the list is just
 * a read for the screen.
 */
export async function fetchPayoutBatches(filters: { page: number }): Promise<Page<PayoutBatchRow>> {
  const body = await adminRequest<unknown>('/api/v1/admin/payout-batches', {
    query: paginationParams(filters.page, 20),
  });

  return parsePage<PayoutBatchRow>(body, 'batches');
}

/** Ops-accessible: "payout batch create/review" is judgment work per the permission split. */
export const createPayoutBatch = (): Promise<CreateBatchResult> =>
  adminRequest('/api/v1/admin/payments/payout-batches', { method: 'POST', body: {} });

export const fetchPayoutBatch = (batchId: string): Promise<{ batch: PayoutBatchDetail }> =>
  adminRequest(`/api/v1/admin/payments/payout-batches/${batchId}`);

/** Ops-accessible: closing a batch is not in `ADMIN_ONLY_ROUTES`. */
export const closePayoutBatch = (batchId: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/payments/payout-batches/${batchId}/close`, {
    method: 'POST',
    body: {},
  });

/** admin-only (`ADMIN_ONLY_ROUTES`) — the button that calls this is hidden for ops, see PayoutBatchPage. */
export const markPayoutPaid = (payoutId: string, utrRef: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/payments/payouts/${payoutId}/paid`, {
    method: 'POST',
    body: { utrRef },
  });

/** admin-only (`ADMIN_ONLY_ROUTES`) — the button that calls this is hidden for ops, see PayoutBatchPage. */
export const markPayoutFailed = (payoutId: string, note: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/payments/payouts/${payoutId}/failed`, {
    method: 'POST',
    body: { note },
  });

/** admin-only (`ADMIN_ONLY_ROUTES`) — the button that calls this is hidden for ops, see MoneyPage. */
export const settleDues = (input: {
  providerId: string;
  amountPaise: number;
  memo: string;
}): Promise<unknown> =>
  adminRequest('/api/v1/admin/payments/dues/settle', { method: 'POST', body: input });

export interface JournalFilters {
  journal_type?: string;
  booking_id?: string;
  provider_id?: string;
  page: number;
}

export async function fetchJournals(filters: JournalFilters): Promise<Page<JournalRow>> {
  const body = await adminRequest<unknown>('/api/v1/admin/ledger/journals', {
    query: { ...filters, ...paginationParams(filters.page, 20) },
  });

  return parsePage<JournalRow>(body, 'journals');
}

export const fetchJournal = (journalId: string): Promise<{ journal: JournalDetail }> =>
  adminRequest(`/api/v1/admin/ledger/journals/${journalId}`);

/* -------------------------------------------------------------------------- */
/* Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export interface CouponFilters {
  status?: string;
  q?: string;
  city_id?: string;
  page: number;
}

/**
 * The coupon list. Readable by ops; every mutation below is admin-only.
 *
 * That split is the router's, not this file's invention — see the comment on
 * `opsRouter` in `apps/api/src/modules/coupons/routes.ts`: a coupon commits
 * the platform to spending its own commission, so creating or changing one is
 * the same class of decision as a commission rate, while *seeing* which
 * campaigns are live is part of answering a customer's "why didn't my code
 * work".
 */
/**
 * Platform-wide coupon totals, across every coupon rather than a page of them.
 *
 * Separate from `fetchCoupons` on purpose: that endpoint aggregates only the
 * ids it is about to return, which is right for a per-row "used" column and
 * wrong for a headline figure.
 */
export async function fetchCouponStats(): Promise<CouponStats> {
  return adminRequest<CouponStats>('/api/v1/admin/coupons/stats');
}

export async function fetchCoupons(filters: CouponFilters): Promise<Page<CouponRow>> {
  const body = await adminRequest<unknown>('/api/v1/admin/coupons', {
    query: {
      status: filters.status,
      q: filters.q,
      city_id: filters.city_id,
      ...paginationParams(filters.page, 20),
    },
  });

  return parsePage<CouponRow>(body, 'coupons');
}

/**
 * Creating a campaign. admin-only (`ADMIN_ONLY_ROUTES`).
 *
 * The input mirrors `createCouponSchema` exactly — the API's schema is
 * `.strict()`, so an extra key here is a 400 rather than a quietly ignored
 * field. `maxDiscountPaise` is required with no "unlimited" option, because an
 * uncapped percentage on a large quotation is an unbounded loss.
 */
export interface CreateCouponInput {
  code: string;
  description: string;
  discountType: 'percent' | 'flat';
  /** Whole percent for `percent`, paise for `flat`. */
  value: number;
  maxDiscountPaise: number;
  minOrderPaise: number;
  validFrom: string;
  validUntil: string;
  totalUsageLimit?: number;
  perCustomerLimit: number;
  cityId?: number;
  categoryId?: number;
}

export const createCoupon = (input: CreateCouponInput): Promise<{ coupon: CouponRow }> =>
  adminRequest('/api/v1/admin/coupons', { method: 'POST', body: input });

/**
 * An edit. admin-only (`ADMIN_ONLY_ROUTES`).
 *
 * `code` and `discountType` are deliberately absent: the API refuses both.
 * A code is printed on posters and a type change would reinterpret `value`
 * ("20 percent" silently becoming "20 paise") on a live campaign — a campaign
 * needing either is a new coupon, not an edit.
 *
 * The nullable fields distinguish "leave alone" (omitted) from "clear"
 * (explicit null), which is why they are `number | null` rather than optional
 * numbers.
 */
export interface UpdateCouponInput {
  description?: string;
  value?: number;
  maxDiscountPaise?: number;
  minOrderPaise?: number;
  validFrom?: string;
  validUntil?: string;
  totalUsageLimit?: number | null;
  perCustomerLimit?: number;
  cityId?: number | null;
  categoryId?: number | null;
}

export const updateCoupon = (
  couponId: string,
  input: UpdateCouponInput,
): Promise<{ coupon: CouponRow }> =>
  adminRequest(`/api/v1/admin/coupons/${couponId}`, { method: 'PATCH', body: input });

/**
 * Pause and resume are two routes rather than one `PATCH {status}` — they are
 * separate audit actions, so "show me every campaign somebody switched off" is
 * a filter on `action` and not a scan of payloads. Both admin-only.
 */
export const pauseCoupon = (couponId: string): Promise<{ coupon: CouponRow }> =>
  adminRequest(`/api/v1/admin/coupons/${couponId}/pause`, { method: 'POST', body: {} });

export const resumeCoupon = (couponId: string): Promise<{ coupon: CouponRow }> =>
  adminRequest(`/api/v1/admin/coupons/${couponId}/resume`, { method: 'POST', body: {} });

/* -------------------------------------------------------------------------- */
/* Parked queues                                                              */
/* -------------------------------------------------------------------------- */

export async function fetchParkedOutbox(page: number): Promise<Page<OutboxRow>> {
  const body = await adminRequest<unknown>('/api/v1/admin/queues/outbox', {
    query: paginationParams(page, 20),
  });

  return parsePage<OutboxRow>(body, 'events');
}

export async function fetchParkedWebhooks(page: number): Promise<Page<WebhookRow>> {
  const body = await adminRequest<unknown>('/api/v1/admin/queues/webhooks', {
    query: paginationParams(page, 20),
  });

  return parsePage<WebhookRow>(body, 'webhooks');
}

export async function fetchParkedDeliveries(page: number): Promise<Page<DeliveryRow>> {
  const body = await adminRequest<unknown>('/api/v1/admin/queues/deliveries', {
    query: paginationParams(page, 20),
  });

  return parsePage<DeliveryRow>(body, 'deliveries');
}

export const retryOutbox = (id: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/queues/outbox/${id}/retry`, { method: 'POST', body: {} });

export const discardOutbox = (id: string, reason: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/queues/outbox/${id}/discard`, { method: 'POST', body: { reason } });

export const reprocessWebhook = (id: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/queues/webhooks/${id}/reprocess`, { method: 'POST', body: {} });

export const discardWebhook = (id: string, reason: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/queues/webhooks/${id}/discard`, { method: 'POST', body: { reason } });

export const retryDelivery = (id: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/queues/deliveries/${id}/retry`, { method: 'POST', body: {} });

export const discardDelivery = (id: string, reason: string): Promise<unknown> =>
  adminRequest(`/api/v1/admin/queues/deliveries/${id}/discard`, {
    method: 'POST',
    body: { reason },
  });

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

/**
 * The response also carries `scope` — `'own'` when the server forced the
 * filter to this actor (an ops token) or `'all'` for admin. `parsePage`
 * only normalises the paginated shape, so `scope` is read off the raw body
 * directly, defaulting to `'own'` — the safer misread if a response somehow
 * omitted it is "you're seeing less than you think", not the other way
 * round.
 */
export async function fetchAuditLogs(
  filters: AuditFilters,
): Promise<{ page: Page<AuditRow>; scope: AuditScope }> {
  const body = await adminRequest<Record<string, unknown>>('/api/v1/admin/audit-logs', {
    query: { ...filters, ...paginationParams(filters.page, 20) },
  });

  return {
    page: parsePage<AuditRow>(body, 'entries'),
    scope: body.scope === 'all' ? 'all' : 'own',
  };
}
