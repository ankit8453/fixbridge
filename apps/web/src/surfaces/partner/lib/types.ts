/**
 * Wire types for the partner surface, hand-written rather than imported.
 *
 * `packages/shared` only carries types every surface needs (auth, money,
 * geography) — domain DTOs like a provider profile or a booking detail live
 * only in `apps/api/src/modules/**` and are not published anywhere this app
 * can import from. These mirror the API's `types.ts` files field for field
 * (cited per block) so a shape drift shows up as a TypeScript error at the
 * call site instead of a silent `undefined` in production. Ported verbatim
 * from `legacy-next-src/components/partner/lib/types.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Providers — apps/api/src/modules/providers/types.ts                        */
/* -------------------------------------------------------------------------- */

export type PriceType = 'fixed' | 'starting_from' | 'inspection_based';
export type ProviderDocumentType = 'id_proof' | 'certificate' | 'photo' | 'other';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const COMPLETENESS_ITEMS = [
  'displayName',
  'baseLocation',
  'skills',
  'priceCard',
  'availability',
  'bio',
  'yearsExperience',
  'photoDocument',
] as const;
export type CompletenessItem = (typeof COMPLETENESS_ITEMS)[number];

export interface CompletenessBreakdownEntry {
  item: CompletenessItem;
  weight: number;
  required: boolean;
  satisfied: boolean;
}

export interface ProviderCompletenessResponse {
  score: number;
  threshold: number;
  isListed: boolean;
  missing: CompletenessItem[];
  missingRequired: CompletenessItem[];
  breakdown: CompletenessBreakdownEntry[];
}

export interface ProviderSkillResponse {
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  experienceNote: string | null;
}

export interface ProviderPriceCardResponse {
  id: string;
  categoryId: number;
  categoryName: string;
  title: string;
  priceType: PriceType;
  amountPaise: number | null;
  isActive: boolean;
}

export interface ProviderAvailabilityResponse {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface ProviderDocumentResponse {
  id: string;
  docType: ProviderDocumentType;
  storageKey: string;
  status: string;
  createdAt: string;
}

export interface ProviderProfileResponse {
  userId: string;
  displayName: string | null;
  bio: string | null;
  yearsExperience: number | null;
  cityId: number;
  baseLocation: GeoPoint | null;
  serviceRadiusKm: number;
  assistedOnboarding: boolean;
  isListed: boolean;
  verification: { badge: string; badgeSince: string | null; levelsPassed: number[] };
  completeness: ProviderCompletenessResponse;
  skills: ProviderSkillResponse[];
  priceCards: ProviderPriceCardResponse[];
  availability: ProviderAvailabilityResponse[];
  documents: ProviderDocumentResponse[];
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Categories — apps/api/src/modules/categories                               */
/* -------------------------------------------------------------------------- */

export interface CategoryNode {
  id: number;
  slug: string;
  name: string;
  nameKey: string;
  icon: string | null;
  sortOrder: number;
  children: CategoryNode[];
}

/* -------------------------------------------------------------------------- */
/* Verification — apps/api/src/modules/verification/types.ts                  */
/* -------------------------------------------------------------------------- */

export type VerificationDocStatus = 'awaiting_upload' | 'uploaded' | 'rejected';

export interface VerificationDocumentResponse {
  id: string;
  docType: ProviderDocumentType;
  status: VerificationDocStatus;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string | null;
  createdAt: string;
}

export interface UploadUrlResponse {
  document: VerificationDocumentResponse;
  upload: { url: string; requiredHeaders: Record<string, string>; expiresInSeconds: number };
  message: string;
}

export type VerificationCaseStatus = 'submitted' | 'in_review' | 'needs_info' | 'passed' | 'failed';

export interface VerificationEventResponse {
  id: string;
  eventType: string;
  actorType: 'provider' | 'ops' | 'system';
  notes: string | null;
  payload: unknown;
  createdAt: string;
}

export interface VerificationCaseResponse {
  id: string;
  level: number;
  levelName: string;
  status: VerificationCaseStatus;
  openedAt: string;
  closedAt: string | null;
  events: VerificationEventResponse[];
}

export type Badge = 'NONE' | 'VERIFIED' | 'SILVER' | 'GOLD';

export interface VerificationSummaryResponse {
  badge: Badge;
  badgeSince: string | null;
  levelsPassed: number[];
  levelsRemaining: number[];
}

export interface VerificationCasesResponse {
  cases: VerificationCaseResponse[];
  summary: VerificationSummaryResponse;
}

/* -------------------------------------------------------------------------- */
/* Bookings — apps/api/src/modules/bookings/types.ts + state-machine.ts       */
/* -------------------------------------------------------------------------- */

export type BookingStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'WORK_DONE'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_PROVIDER'
  | 'CLOSED_QUOTE_DECLINED';

export const REJECTION_REASONS = ['too_far', 'busy', 'wrong_skill', 'other'] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const PROVIDER_CANCEL_REASONS = [
  'emergency',
  'vehicle_issue',
  'wrong_skill',
  'other',
] as const;
export type ProviderCancelReason = (typeof PROVIDER_CANCEL_REASONS)[number];

export interface BookingEventView {
  id: string;
  eventType: string;
  actorType: 'customer' | 'provider' | 'system' | 'ops';
  payload: unknown;
  createdAt: string;
}

export interface BookingAddress {
  addressText: string;
  landmark: string | null;
  cityId: number;
  lat: number;
  lng: number;
}

export interface PayableComponent {
  kind: string;
  labelKey: string;
  amountPaise: number;
  waived?: boolean;
}

export interface PayableView {
  payablePaise: number;
  payableDisplay: string;
  visitFeeCharged: boolean;
  basis: 'approved_quotation' | 'price_card' | 'visit_fee_only';
  components: PayableComponent[];
}

export interface QuotationItemView {
  id: string;
  kind: 'part' | 'labour_extra';
  description: string;
  qty: number;
  unitPaise: number;
  lineTotalPaise: number;
}

export type QuotationStatus = 'sent' | 'approved' | 'rejected' | 'superseded' | 'withdrawn';

export interface QuotationView {
  id: string;
  bookingId: string;
  version: number;
  status: QuotationStatus;
  labourPaise: number;
  partsTotalPaise: number;
  totalPaise: number;
  totalDisplay: string;
  note: string | null;
  decisionNote: string | null;
  items: QuotationItemView[];
  decidedAt: string | null;
  createdAt: string;
}

export interface BookingDetail {
  id: string;
  status: BookingStatus;
  categoryId: number;
  startsAt: string;
  endsAt: string;
  problemNote: string | null;
  visitFeePaise: number;
  quotations: QuotationView[];
  pendingQuotation: QuotationView | null;
  approvedQuotation: QuotationView | null;
  payablePaise: number | null;
  payable: PayableView | null;
  address: BookingAddress | null;
  counterpart: { name: string | null; phone: string | null; phoneRevealed: boolean };
  startOtp: string | null;
  endOtp: string | null;
  events: BookingEventView[];
  createdAt: string;
}

export interface PublicSlot {
  id: string;
  startsAt: string;
  endsAt: string;
}

/**
 * A technician's own slot — `GET /api/v1/providers/me/slots` (added this
 * phase, `apps/api/src/modules/bookings/slots-service.ts` `listOwnSlots`),
 * distinct from the public `PublicSlot` shape: carries `status` and
 * `bookingId`, which the public endpoint deliberately withholds from
 * strangers. This is what makes the slots screen able to show — and
 * un-block — a slot blocked in an earlier visit, not just one blocked this
 * session.
 */
export interface OwnSlot extends PublicSlot {
  status: 'open' | 'blocked' | 'booked';
  bookingId: string | null;
}

/* -------------------------------------------------------------------------- */
/* Payments / wallet — apps/api/src/modules/payments/types.ts                 */
/* -------------------------------------------------------------------------- */

export interface PayoutView {
  id: string;
  batchId: string;
  providerId: string;
  amountPaise: number;
  amountDisplay: string;
  status: 'pending' | 'paid' | 'failed';
  utrRef: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface WalletLedgerLine {
  journalId: string;
  journalType: string;
  accountType: string;
  direction: 'debit' | 'credit';
  amountPaise: number;
  amountDisplay: string;
  bookingId: string | null;
  createdAt: string;
}

export interface WalletResponse {
  providerId: string;
  payablePaise: number;
  payableDisplay: string;
  duesPaise: number;
  duesDisplay: string;
  netPaise: number;
  netDisplay: string;
  pendingPayoutPaise: number;
  payoutMinimumPaise: number;
  recentPayouts: PayoutView[];
  ledger: WalletLedgerLine[];
}

export interface PaymentView {
  id: string;
  bookingId: string | null;
  purpose: 'final_bill' | 'visit_fee_upfront';
  method: 'online' | 'cash';
  amountPaise: number;
  amountDisplay: string;
  status: 'created' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
  commissionBps: number;
  gatewayOrderId: string | null;
  checkoutVerifiedAt: string | null;
  capturedAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Trust — apps/api/src/modules/trust/routes.ts                               */
/* -------------------------------------------------------------------------- */

export interface TrustComponentView {
  name: string;
  label: string;
  reason: string;
  raw: number | null;
  normalized: number | null;
  weight: number;
  contribution: number;
  pending: boolean;
}

export interface TrustNextBand {
  band: 'SILVER' | 'GOLD';
  needsScore: number;
  needsJobs: number;
}

export interface TrustTrendPoint {
  score: number;
  badge: Badge;
  trigger: string;
  at: string;
}

export interface TrustResponse {
  score: number;
  badge: Badge;
  settledJobs: number;
  components: TrustComponentView[];
  nextBand: TrustNextBand | null;
  suspendedUntil: string | null;
  suspensionReason: string | null;
  trend: TrustTrendPoint[];
}

/* -------------------------------------------------------------------------- */
/* Notifications — apps/api/src/modules/notifications/types.ts                */
/* -------------------------------------------------------------------------- */

export interface NotificationView {
  id: string;
  topic: string;
  title: string;
  body: string;
  deepLink: string | null;
  criticality: 'critical' | 'normal' | 'low';
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  unread: number;
}
