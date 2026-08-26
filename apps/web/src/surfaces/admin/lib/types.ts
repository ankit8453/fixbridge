/**
 * The API's response shapes, as far as this surface reads them. Ported from
 * `legacy-next-src/components/admin/lib/types.ts` verbatim — nothing about
 * the shape changes by moving from Next.js into this router.
 *
 * Deliberately partial. These are hand-written mirrors of what
 * `apps/api/src/modules/admin` returns, not generated types, so every field
 * here is one a screen actually renders — anything the API adds later is
 * simply ignored rather than breaking a build. Optional markers are used
 * liberally on nested objects because several of these endpoints return
 * relations that can genuinely be absent (a provider with no verification
 * row, a booking with no quotation), and a screen that throws on a missing
 * relation is a screen that dies on exactly the edge case ops opened it to
 * look at.
 */

export type TrustBadge = 'NONE' | 'VERIFIED' | 'SILVER' | 'GOLD';

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export interface AdminSummary {
  queues: {
    verificationPending: number;
    complaintsOpen: number;
    reviewReports: number;
    parkedOutbox: number;
    parkedWebhooks: number;
    parkedDeliveries: number;
    heldDeliveries: number;
    pendingBatches: number;
    otpLockedBookings: number;
    suspendedProviders: number;
    pendingEntryApproval: number;
  };
  bookings: {
    today: Record<string, number>;
    todayTotal: number;
  };
  money: {
    gmvTodayPaise: number;
    gmv7dPaise: number;
    gmv30dPaise: number;
    revenuePaise: number;
    gatewayCashPaise: number;
    owedToProvidersPaise: number;
    owedByProvidersPaise: number;
  };
  generatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

export interface VerificationQueueRow {
  caseId: string;
  providerId: string;
  providerName: string | null;
  cityId: number;
  level: number;
  status: string;
  openedAt: string;
}

export interface VerificationEvent {
  id: string;
  eventType: string;
  actorType: string;
  notes: string | null;
  payload: unknown;
  createdAt: string;
}

export interface VerificationCase {
  id: string;
  level: number;
  levelName: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  events: VerificationEvent[];
}

export interface VerificationDocument {
  id: string;
  docType: string;
  status: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string | null;
  createdAt: string;
  downloadUrl: string;
}

export interface VerificationSummary {
  badge: TrustBadge;
  badgeSince: string | null;
  levelsPassed: number[];
  levelsRemaining?: number[];
}

export interface VerificationCaseDetail {
  case: VerificationCase;
  provider: { id: string; displayName: string | null; cityId: number };
  documents: VerificationDocument[];
  summary: VerificationSummary;
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProviderRow {
  userId: string;
  displayName: string | null;
  cityId: number;
  isListed: boolean;
  completenessScore: number;
  suspendedUntil: string | null;
  suspensionReason: string | null;
  user?: { phone: string; status: string } | null;
  verification?: { badge: TrustBadge } | null;
  stats?: { trustScore: number | null; settledJobsCount: number; avgStars: number | null } | null;
}

/**
 * `provider_stats`, verbatim.
 *
 * The screen shows the trust score's **inputs** rather than a weighted
 * breakdown, because these columns are what the admin aggregate returns and
 * they are what an ops user needs when a technician asks why their score
 * dropped: the ratings, the acceptance record, the cancellations and the
 * upheld complaints. Weights live in API config and are not exposed on this
 * endpoint.
 */
export interface ProviderStats {
  trustScore: number | null;
  trustScoreUpdated?: string | null;
  settledJobsCount: number;
  lastSettledAt?: string | null;
  avgStars: number | null;
  reviewCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  expiredCount?: number;
  cancelledByProviderCount?: number;
  acceptanceRate?: number | null;
  windowDays?: number;
  complaintsMinorCount?: number;
  complaintsMajorCount?: number;
  complaintsSevereCount?: number;
}

export interface ProviderDetail {
  userId: string;
  displayName: string | null;
  bio: string | null;
  yearsExperience: number | null;
  cityId: number;
  serviceRadiusKm: number | null;
  isListed: boolean;
  completenessScore: number;
  entryApprovedAt: string | null;
  suspendedUntil: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  user: { id: string; phone: string; name: string | null; status: string };
  city?: { id: number; name: string; requireEntryApproval: boolean } | null;
  verification?: {
    badge: TrustBadge;
    levelsPassed: number[];
    badgeSince: string | null;
  } | null;
  stats?: ProviderStats | null;
  skills?: { categoryId: number; category?: { nameKey: string } | null }[];
  priceCards?: {
    id: string;
    title: string;
    priceType: string;
    amountPaise: number | null;
    categoryId: number;
  }[];
  verificationCases?: {
    id: string;
    level: number;
    status: string;
    openedAt: string;
    closedAt: string | null;
  }[];
  visibility: {
    listed: boolean;
    accountActive: boolean;
    verified: boolean;
    notSuspended: boolean;
    entryApproved: boolean;
  };
  balance: { payablePaise: number; duesPaise: number; netPaise: number };
  recentBookings: {
    id: string;
    status: string;
    startsAt: string | null;
    payablePaise: number | null;
    createdAt: string;
    category?: { nameKey: string } | null;
  }[];
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

export interface BookingRow {
  id: string;
  status: string;
  startsAt: string | null;
  payablePaise: number | null;
  createdAt: string;
  customer?: { id: string; name: string | null; phone: string } | null;
  provider?: { userId: string; displayName: string | null } | null;
  category?: { nameKey: string } | null;
}

export interface BookingTimelineResponse {
  booking: {
    id: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    problemNote: string | null;
    addressSnapshot: unknown;
    visitFeePaise: number | null;
    payablePaise: number | null;
    payableBreakdown: unknown;
    priceCardAmountPaise: number | null;
    createdAt: string;
    customer?: { id: string; name: string | null; phone: string } | null;
    provider?: {
      userId: string;
      displayName: string | null;
      user?: { phone: string } | null;
    } | null;
    category?: { nameKey: string } | null;
    events: {
      id: string;
      eventType: string;
      actorType?: string;
      payload?: unknown;
      createdAt: string;
    }[];
    quotations: {
      id: string;
      version: number;
      status: string;
      totalPaise: number | null;
      createdAt: string;
      items?: { id: string; description: string; amountPaise: number; quantity?: number }[];
    }[];
    payments: {
      id: string;
      method: string;
      status: string;
      amountPaise: number;
      createdAt: string;
      refunds?: { id: string; amountPaise: number; status: string; createdAt: string }[];
    }[];
    reviews: {
      id: string;
      stars: number;
      direction?: string;
      text: string | null;
      createdAt: string;
    }[];
    complaints: { id: string; category: string; status: string; createdAt: string }[];
  };
  notifications: {
    id: string;
    topic: string;
    titleKey: string;
    createdAt: string;
    user?: { id: string; name: string | null } | null;
    deliveries?: { id: string; channel: string; status: string; createdAt: string }[];
  }[];
  otpLocked: boolean;
}

/* -------------------------------------------------------------------------- */
/* Complaints and reviews                                                     */
/* -------------------------------------------------------------------------- */

export interface Complaint {
  id: string;
  bookingId: string;
  category: string;
  description: string;
  status: 'open' | 'in_review' | 'resolved' | 'dismissed';
  raisedByUserId: string;
  againstUserId: string;
  resolutionNote: string | null;
  severity: 'minor' | 'major' | 'severe' | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface ReviewReport {
  id: string;
  reviewId: string;
  reason: string;
  createdAt: string;
  reporter?: { id: string; name: string | null } | null;
  review?: {
    id: string;
    stars: number;
    text: string | null;
    tags?: string[];
    status?: string;
    direction?: string;
    bookingId?: string;
    /** Who the review is about — the technician, for a public review. */
    subjectUserId?: string;
    author?: { id: string; name: string | null } | null;
    createdAt?: string;
  } | null;
}

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

export interface PayoutBatchRow {
  id: string;
  status: string;
  windowEnd: string | null;
  totalPaise: number;
  payoutCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface Payout {
  id: string;
  providerId: string;
  amountPaise: number;
  status: string;
  utrRef: string | null;
  note?: string | null;
  createdAt: string;
  paidAt?: string | null;
}

export interface PayoutBatchDetail extends PayoutBatchRow {
  payouts: Payout[];
}

export interface CreateBatchResult {
  batchId: string | null;
  totalPaise?: number;
  payoutCount?: number;
  skipped?: { providerId: string; reason: string; netPaise?: number }[];
}

export interface JournalRow {
  id: string;
  journalType: string;
  memo: string | null;
  bookingId: string | null;
  paymentId: string | null;
  createdAt: string;
  _count?: { entries: number };
}

export interface JournalDetail {
  id: string;
  journalType: string;
  memo: string | null;
  bookingId: string | null;
  paymentId: string | null;
  createdAt: string;
  entries: {
    id: string;
    direction: 'debit' | 'credit';
    amountPaise: number;
    account?: { accountType: string; ownerType: string | null; ownerId: string | null } | null;
  }[];
}

/* -------------------------------------------------------------------------- */
/* Parked queues                                                              */
/* -------------------------------------------------------------------------- */

export interface OutboxRow {
  id: string;
  topic: string;
  aggregateType: string;
  aggregateId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface WebhookRow {
  id: string;
  gatewayEventId: string;
  eventType: string;
  processingError: string | null;
  processedAt: string | null;
  receivedAt: string;
}

export interface DeliveryRow {
  id: string;
  channel: string;
  topic: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  notification?: { topic: string; titleKey: string; criticality: string } | null;
  recipient?: { id: string; name: string | null } | null;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  actorUserId: string;
  actor?: { id: string; name: string | null; phone: string } | null;
}

/**
 * The audit log endpoint returns which slice of the table the caller is
 * looking at — `'own'` for an ops token (the server forces that filter, it
 * is not a client choice), `'all'` for admin. The audit page renders this so
 * an ops user reading their own actions never mistakes the list for the
 * whole log.
 */
export type AuditScope = 'own' | 'all';

/* -------------------------------------------------------------------------- */
/* Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export type CouponDiscountType = 'percent' | 'flat';

/** `expired` is derived from the window on read by the API, never stored. */
export type CouponStatus = 'active' | 'paused' | 'expired';

/**
 * One row of `GET /admin/coupons` — mirrors `CouponView` in
 * `apps/api/src/modules/coupons/types.ts`.
 *
 * Money arrives twice over: `*Paise` as the integer the system actually works
 * in, and `*Display` as the string the API already formatted. This surface
 * renders from the paise through `formatPaise` (one formatter, matching the
 * API's own) rather than the display strings, so a screen and a ledger can
 * never disagree about a number — but the display fields are typed here
 * because they are part of the contract and a future consumer may want them.
 */
export interface CouponRow {
  id: string;
  code: string;
  description: string;
  discountType: CouponDiscountType;
  /** Whole percent for `percent`, paise for `flat`. */
  value: number;
  maxDiscountPaise: number;
  maxDiscountDisplay: string;
  minOrderPaise: number;
  minOrderDisplay: string;
  validFrom: string;
  validUntil: string;
  /** Null means no global ceiling on redemptions. */
  totalUsageLimit: number | null;
  perCustomerLimit: number;
  status: CouponStatus;
  /** Null means every city / every category. */
  cityId: number | null;
  categoryId: number | null;
  redemptionCount: number;
  /** What this campaign has cost the platform's commission so far. */
  discountedPaise: number;
  discountedDisplay: string;
  createdAt: string;
  updatedAt: string;
}

/** Platform-wide coupon totals — see `fetchCouponStats`. */
export interface CouponStats {
  totalCoupons: number;
  activeCoupons: number;
  redemptionCount: number;
  /** What the platform has given away, out of its own commission. */
  discountedPaise: number;
}
