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

/* -------------------------------------------------------------------------- */
/* Profile photo                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where the technician's public-facing photo stands with ops.
 *
 * Not a document status — this is a separate store from KYC with the opposite
 * privacy posture. A KYC document is evidence only a reviewer sees; this is the
 * one file a customer is meant to see.
 *
 * A photo publishes the moment its upload is confirmed: a technician's own face
 * is their property, not something to queue behind a reviewer. `removed` only
 * happens after customers report a photo and a human agrees with them.
 */
export type ProfilePhotoStatus = 'approved' | 'removed';

export interface ProfilePhoto {
  status: ProfilePhotoStatus;
  /**
   * Short-lived signed URL. Present in every status, because a technician whose
   * photo was taken down needs to see which one it was to replace it.
   */
  url: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
  /** Ops' reason, verbatim. Only ever set when the photo was taken down. */
  rejectionNote: string | null;
}

export interface PhotoUploadUrlResponse {
  photoId: string;
  upload: { url: string; requiredHeaders: Record<string, string>; expiresInSeconds: number };
  message: string;
}

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
  /** The rate the customer booked on. The quotation form is built from it. */
  agreedLabour: AgreedLabour;
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
  /**
   * What they earned, summed from the bills rather than the ledger.
   *
   * Optional so an older API — which does not send it — renders an empty
   * earnings block rather than failing the whole screen.
   */
  earnings?: EarningsSummary;
}

export interface EarningsPeriod {
  jobCount: number;
  grossPaise: number;
  grossDisplay: string;
}

export interface EarningsLine {
  bookingId: string;
  method: string;
  grossPaise: number;
  grossDisplay: string;
  commissionPaise: number;
  commissionDisplay: string;
  earnedPaise: number;
  earnedDisplay: string;
  at: string;
}

/**
 * The other money question. The ledger records what moves between us and the
 * technician; at the pilot's zero commission that is nothing, so without this
 * a technician who has finished nine jobs sees an empty page.
 */
export interface EarningsSummary {
  thisWeek: EarningsPeriod;
  thisMonth: EarningsPeriod;
  allTime: EarningsPeriod;
  recent: EarningsLine[];
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
  /**
   * Mirrors the API's `NotificationCriticality` enum, which has exactly two
   * values. This said `'critical' | 'normal' | 'low'` — a vocabulary the server
   * never sends — so every lookup keyed on it missed for real rows and the
   * inbox crashed on an undefined icon component.
   */
  criticality: 'critical' | 'standard';
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

/**
 * The rate the customer booked on, snapshotted at creation.
 *
 * `fixed` locks labour exactly, `starting_from` makes it a floor, and
 * `inspection_based` leaves it open. Null on a booking made without a card.
 */
export interface AgreedLabour {
  priceType: 'fixed' | 'starting_from' | 'inspection_based' | null;
  amountPaise: number | null;
}

/**
 * Where a technician's money goes.
 *
 * The account number and PAN arrive already masked — the API never returns
 * them whole, not even to the person they belong to. There is deliberately
 * nowhere in this type to put a full one.
 */
export interface PayoutDetailResponse {
  method: 'bank' | 'upi';
  /** `••••••7890`, or null when paid by UPI. */
  accountNumberMasked: string | null;
  ifsc: string | null;
  accountHolder: string | null;
  /** Shown in full — a UPI handle is what you give people so they can pay you. */
  upiId: string | null;
  /** `ABCDE••••F`, or null when no PAN has been given. */
  panMasked: string | null;
  updatedAt: string;
}

/** What the form sends. Mirrors the API's discriminated union exactly. */
export type PayoutDetailInput =
  | {
      method: 'bank';
      accountNumber: string;
      confirmAccountNumber: string;
      ifsc: string;
      accountHolder: string;
      pan?: string;
    }
  | { method: 'upi'; upiId: string; pan?: string };
