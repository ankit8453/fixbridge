/**
 * Response/request shapes for the customer surface, copied field-for-field
 * from the API route handlers this app calls (`apps/api/src/modules/*\/types.ts`
 * and `docs/API.md`) rather than guessed. Kept local to this surface (not
 * `packages/shared`, which is deliberately small) because these are wire
 * shapes one surface consumes, not a type two runtimes need to agree on the
 * way `AuthUser` does. Ported from `legacy-next-src/components/customer/data/types.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

export interface CategoryNode {
  id: number;
  slug: string;
  name: string;
  nameKey: string;
  icon: string | null;
  sortOrder: number;
  /**
   * Searchable providers behind this category (listed + verified + active,
   * the same gates search applies; a cluster sums its services). Cached for
   * 5 minutes server-side: a browsing hint, not a live number.
   */
  providerCount: number;
  children: CategoryNode[];
}

export interface CategoriesResponse {
  cityId: number;
  categories: CategoryNode[];
}

/* -------------------------------------------------------------------------- */
/* Customer profile + addresses                                               */
/* -------------------------------------------------------------------------- */

export interface CustomerProfile {
  userId: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AddressLabel = 'home' | 'shop' | 'other';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface AddressResponse {
  id: string;
  label: AddressLabel;
  labelText: string | null;
  addressText: string;
  landmark: string | null;
  cityId: number;
  location: GeoPoint;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAddressInput {
  label: AddressLabel;
  labelText?: string;
  addressText: string;
  landmark?: string;
  cityId?: number;
  isDefault?: boolean;
  lat?: number;
  lng?: number;
}

export type UpdateAddressInput = Partial<Omit<CreateAddressInput, 'isDefault'>>;

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export type Badge = 'NONE' | 'VERIFIED' | 'SILVER' | 'GOLD';

export interface SearchSkill {
  categoryId: number;
  slug: string;
  name: string;
}

export interface SearchAvailabilityWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface SearchResultCard {
  providerId: string;
  displayName: string | null;
  badge: Badge;
  rating: { average: number; count: number } | null;
  jobsCompleted: number;
  yearsExperience: number | null;
  distanceKm: number;
  skills: SearchSkill[];
  startingPrice: { amountPaise: number; display: string } | null;
  nextAvailability: SearchAvailabilityWindow | null;
  locality: string | null;
}

export interface SearchProvidersResponse {
  results: SearchResultCard[];
  page: number;
  pageSize: number;
  total: number;
  truncated: boolean;
  sort: 'rank' | 'distance' | 'price_low';
  query: {
    cityId: number;
    categoryId: number | null;
    maxDistanceKm: number | null;
    availability: { dayOfWeek: number; startTime: string; endTime: string } | null;
  };
}

export interface SearchProvidersQuery {
  lat: number;
  lng: number;
  city_id?: number;
  category_id?: number;
  max_distance_km?: number;
  sort?: 'rank' | 'distance' | 'price_low';
  page?: number;
  page_size?: number;
}

export type MatchReason = 'synonym_exact' | 'synonym_prefix' | 'synonym_fuzzy' | 'category_name';

export interface CategorySuggestion {
  categoryId: number;
  slug: string;
  name: string;
  nameKey: string;
  parentId: number | null;
  matchReason: MatchReason;
  confidence: number;
  matchedTerm: string | null;
}

export interface ResolveResponse {
  query: string;
  normalizedQuery: string;
  suggestions: CategorySuggestion[];
}

/* -------------------------------------------------------------------------- */
/* Provider slots + reviews + public profile (all public)                     */
/* -------------------------------------------------------------------------- */

export interface PublicSlot {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface PublicReviewView {
  id: string;
  stars: number;
  tags: string[];
  text: string | null;
  authorName: string;
  createdAt: string;
}

export interface ProviderReviewsResponse {
  providerId: string;
  averageStars: number | null;
  reviewCount: number;
  tagCounts: Record<string, number>;
  reviews: PublicReviewView[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * `GET /api/v1/providers/:providerId` — added in Phase 12
 * (`apps/api/src/modules/providers/public-profile.ts`). Replaces the old
 * sessionStorage "cache the search result card" workaround: a shared link
 * (WhatsApp forward) now renders a full profile on a cold visit, with no
 * prior search required.
 */
export interface PublicProviderProfile {
  providerId: string;
  displayName: string | null;
  badge: Badge;
  bio: string | null;
  yearsExperience: number | null;
  city: { id: number; name: string } | null;
  rating: { average: number; count: number } | null;
  jobsCompleted: number;
  tagCounts: Record<string, number>;
  skills: { categoryId: number; nameKey: string; slug: string }[];
  priceCards: {
    id: string;
    categoryId: number;
    title: string;
    priceType: string;
    amountPaise: number | null;
    display: string | null;
  }[];
  memberSince: string;
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                    */
/* -------------------------------------------------------------------------- */

export const BOOKING_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'WORK_DONE',
  'CLOSED_QUOTE_DECLINED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const CUSTOMER_CANCEL_REASONS = [
  'changed_mind',
  'found_other',
  'emergency',
  'provider_delay',
  'other',
] as const;

export type CustomerCancelReason = (typeof CUSTOMER_CANCEL_REASONS)[number];

export interface BookingEventView {
  id: string;
  eventType: string;
  actorType: 'customer' | 'provider' | 'system' | 'ops';
  payload: unknown;
  createdAt: string;
}

export interface QuotationItemView {
  id: string;
  kind: 'part' | 'labour_extra';
  description: string;
  qty: number;
  unitPaise: number;
  lineTotalPaise: number;
}

export interface QuotationView {
  id: string;
  bookingId: string;
  version: number;
  status: 'sent' | 'approved' | 'rejected' | 'superseded' | 'withdrawn';
  /** What the customer agreed to at booking. Zero when there was no anchor. */
  agreedLabourPaise: number;
  /** Extra work found on site. Carries a reason whenever it is above zero. */
  extraLabourPaise: number;
  /** Why the extra is charged — shown next to the amount before approval. */
  extraLabourReason: string | null;
  /** `agreedLabourPaise + extraLabourPaise`. */
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

export interface BookingAddressSnapshot {
  addressText: string;
  landmark: string | null;
  cityId: number;
  lat: number;
  lng: number;
}

/**
 * The other party on a booking — the technician, from the customer's side.
 *
 * Extracted from an inline type on `BookingDetail` when the photo was added, so
 * the privacy rules that govern these fields have somewhere to be written down.
 * Every field here is progressively revealed by the API rather than always
 * present: what a customer may see depends on how far the booking has got.
 */
export interface BookingCounterpart {
  name: string | null;
  /** Masked until the booking is accepted. */
  phone: string | null;
  phoneRevealed: boolean;
  /**
   * A short-lived signed URL for the technician's profile photo.
   *
   * Null unless the booking is **accepted or later** AND ops **approved** the
   * photo — the API applies both gates and simply omits the URL otherwise, so
   * this is never a value the client has to decide whether to trust. It is not a
   * KYC document: those are private and never leave the ops console.
   *
   * Expect null often — no photo uploaded, or one still awaiting review — which
   * is why every render site falls back to initials rather than treating a
   * missing photo as an error.
   */
  photoUrl: string | null;
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
  address: BookingAddressSnapshot | null;
  counterpart: BookingCounterpart;
  /** Customer only, from ACCEPTED. */
  startOtp: string | null;
  /** Customer only, from IN_PROGRESS. */
  endOtp: string | null;
  events: BookingEventView[];
  createdAt: string;
}

export interface CreateBookingInput {
  slotId: string;
  categoryId: number;
  addressId: string;
  priceCardId?: string;
  problemNote?: string;
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

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

export interface StartPaymentResponse {
  payment: PaymentView;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
  reused: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reviews, complaints                                                        */
/* -------------------------------------------------------------------------- */

export const CUSTOMER_TO_PROVIDER_TAGS = [
  'punctual',
  'polite',
  'fair_price',
  'clean_work',
  'expert',
] as const;

export type CustomerToProviderTag = (typeof CUSTOMER_TO_PROVIDER_TAGS)[number];

export interface ReviewView {
  id: string;
  bookingId: string;
  direction: 'customer_to_provider' | 'provider_to_customer';
  stars: number;
  tags: string[];
  text: string | null;
  status: 'published' | 'hidden';
  createdAt: string;
}

export interface CreateReviewInput {
  stars: number;
  tags: CustomerToProviderTag[];
  text?: string;
}

export const COMPLAINT_CATEGORIES = [
  'overcharge',
  'no_show',
  'quality',
  'behavior',
  'cash_dispute',
  'safety',
  'other',
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export interface ComplaintView {
  id: string;
  bookingId: string;
  category: ComplaintCategory;
  description: string;
  status: 'open' | 'in_review' | 'resolved' | 'dismissed';
  raisedByUserId: string;
  againstUserId: string;
  resolutionNote: string | null;
  severity: 'minor' | 'major' | 'severe' | null;
  createdAt: string;
  resolvedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
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
