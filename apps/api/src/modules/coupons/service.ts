import type { Coupon, Prisma, PrismaClient } from '@prisma/client';
import { AUDIT_ACTIONS, audited, type AuditActor } from '../../core/audit';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { isBillableBooking, type BookingStatus } from '../bookings/state-machine';
import { formatPaise } from '../search/service';
import {
  CouponRejectedError,
  CouponTermsError,
  assertValidTerms,
  computeDiscount,
  normalizeCode,
  type CouponRejectionReason,
  type CouponTerms,
  type PaymentMethodChoice,
} from './discount';
import type {
  AppliedCouponView,
  ApplyCouponInput,
  CouponView,
  CreateCouponInput,
  UpdateCouponInput,
} from './types';

export interface CouponDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: CouponDeps): Date => (deps.now ? deps.now() : new Date());

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Each rejection reason gets its own customer-facing message key.
 *
 * A single "that coupon did not work" would be cheaper to build and worse in
 * every case that matters: a customer whose order is ₹40 short of the minimum
 * can act on "spend a little more", and one whose coupon is simply spent cannot
 * — telling them the same thing wastes the first and frustrates the second.
 */
const REJECTION_KEYS: Record<CouponRejectionReason, string> = {
  not_found: 'errors.coupons.notFound',
  not_active: 'errors.coupons.notActive',
  not_started: 'errors.coupons.notStarted',
  expired: 'errors.coupons.expired',
  below_min_order: 'errors.coupons.belowMinOrder',
  usage_limit_reached: 'errors.coupons.usageLimitReached',
  per_customer_limit_reached: 'errors.coupons.perCustomerLimitReached',
  city_not_eligible: 'errors.coupons.cityNotEligible',
  category_not_eligible: 'errors.coupons.categoryNotEligible',
  cash_not_eligible: 'errors.coupons.cashNotEligible',
  nothing_to_discount: 'errors.coupons.nothingToDiscount',
};

/**
 * Turns a rejection into a 422 the customer's app can render.
 *
 * 422 rather than 400: the request was well-formed, the coupon simply does not
 * apply. That distinction is what lets the client tell "you sent nonsense" apart
 * from "this is a real coupon that is not valid here", which are different
 * screens.
 */
function rejectionToAppError(error: CouponRejectedError): AppError {
  return new AppError(422, 'COUPON_NOT_APPLICABLE', error.message, {
    messageKey: REJECTION_KEYS[error.reason],
    details: { reason: error.reason },
  });
}

const notFound = (couponId: string): AppError =>
  new AppError(404, 'COUPON_NOT_FOUND', `Coupon ${couponId} not found`, {
    messageKey: 'errors.coupons.notFound',
  });

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether a coupon's window has closed, computed rather than stored.
 *
 * A stored `expired` would need a job to keep it true, and a coupon that is
 * past its date but still says `active` because the job has not run yet is a
 * discount somebody gets by accident. So the date decides on read; the stored
 * status only ever distinguishes `active` from ops-`paused`.
 */
function effectiveStatus(coupon: Coupon, at: Date): 'active' | 'paused' | 'expired' {
  if (coupon.status === 'paused') return 'paused';
  if (coupon.validUntil.getTime() <= at.getTime()) return 'expired';
  return 'active';
}

export function toCouponView(
  coupon: Coupon,
  counts: { redemptionCount: number; discountedPaise: number },
  at: Date,
): CouponView {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    value: coupon.value,
    maxDiscountPaise: coupon.maxDiscountPaise,
    maxDiscountDisplay: formatPaise(coupon.maxDiscountPaise),
    minOrderPaise: coupon.minOrderPaise,
    minOrderDisplay: formatPaise(coupon.minOrderPaise),
    validFrom: coupon.validFrom.toISOString(),
    validUntil: coupon.validUntil.toISOString(),
    totalUsageLimit: coupon.totalUsageLimit,
    perCustomerLimit: coupon.perCustomerLimit,
    status: effectiveStatus(coupon, at),
    cityId: coupon.cityId,
    categoryId: coupon.categoryId,
    redemptionCount: counts.redemptionCount,
    discountedPaise: counts.discountedPaise,
    discountedDisplay: formatPaise(counts.discountedPaise),
    createdAt: coupon.createdAt.toISOString(),
    updatedAt: coupon.updatedAt.toISOString(),
  };
}

/** The coupon row as the pure validator wants it. */
function toTerms(coupon: Coupon, at: Date): CouponTerms {
  return {
    code: coupon.code,
    discountType: coupon.discountType,
    value: coupon.value,
    maxDiscountPaise: coupon.maxDiscountPaise,
    minOrderPaise: coupon.minOrderPaise,
    validFrom: coupon.validFrom,
    validUntil: coupon.validUntil,
    // The derived status, so a coupon past its window is refused even if a
    // status backfill has never run.
    status: effectiveStatus(coupon, at),
    cityId: coupon.cityId,
    categoryId: coupon.categoryId,
    totalUsageLimit: coupon.totalUsageLimit,
    perCustomerLimit: coupon.perCustomerLimit,
  };
}

/* -------------------------------------------------------------------------- */
/* Admin — reads                                                              */
/* -------------------------------------------------------------------------- */

export interface ListCouponsQuery {
  page: number;
  page_size: number;
  status?: 'active' | 'paused' | 'expired';
  q?: string;
  city_id?: number;
}

export async function listCoupons(
  deps: CouponDeps,
  query: ListCouponsQuery,
): Promise<{ coupons: CouponView[]; page: number; pageSize: number; total: number }> {
  const { prisma } = deps.context;
  const at = nowOf(deps);

  /**
   * `expired` is a date, not a column, so it is filtered as one.
   *
   * `active` therefore means "stored active AND still inside its window", which
   * is the only reading that matches what the console's badge says.
   */
  const statusWhere: Prisma.CouponWhereInput =
    query.status === 'expired'
      ? { status: { not: 'paused' }, validUntil: { lte: at } }
      : query.status === 'active'
        ? { status: 'active', validUntil: { gt: at } }
        : query.status === 'paused'
          ? { status: 'paused' }
          : {};

  const where: Prisma.CouponWhereInput = {
    ...statusWhere,
    ...(query.city_id ? { cityId: query.city_id } : {}),
    ...(query.q
      ? {
          OR: [
            { code: { contains: normalizeCode(query.q) } },
            { description: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
    }),
    prisma.coupon.count({ where }),
  ]);

  const counts = await redemptionTotals(
    prisma,
    rows.map((row) => row.id),
  );

  return {
    coupons: rows.map((row) => toCouponView(row, counts.get(row.id) ?? EMPTY_COUNTS, at)),
    page: query.page,
    pageSize: query.page_size,
    total,
  };
}

const EMPTY_COUNTS = { redemptionCount: 0, discountedPaise: 0 };

/**
 * Usage counted from the redemption rows, in one grouped query.
 *
 * The alternative — a `times_used` column kept up to date on write — is the
 * same mistake Law #1 forbids in the ledger: a count you can `UPDATE` is a
 * count that can drift, and this one decides whether somebody gets a discount.
 */
async function redemptionTotals(
  prisma: PrismaClient,
  couponIds: string[],
): Promise<Map<string, { redemptionCount: number; discountedPaise: number }>> {
  if (couponIds.length === 0) return new Map();

  const grouped = await prisma.couponRedemption.groupBy({
    by: ['couponId'],
    where: { couponId: { in: couponIds } },
    _count: { _all: true },
    _sum: { discountPaise: true },
  });

  return new Map(
    grouped.map((row) => [
      row.couponId,
      {
        redemptionCount: row._count._all,
        discountedPaise: row._sum.discountPaise ?? 0,
      },
    ]),
  );
}

/**
 * Platform-wide coupon totals, across every coupon rather than a page of them.
 *
 * Deliberately separate from `listCoupons`: that one aggregates redemptions
 * for the ids it is about to return, which is right for a per-row "used" column
 * and wrong for a headline figure. Summing a page and calling it a total would
 * be a number that silently changes when somebody pages or filters.
 *
 * `discountedPaise` is what the platform has actually given away — it comes out
 * of commission, never the technician's earnings, so this is a marketing spend
 * figure and worth watching.
 */
export async function getCouponStats(deps: CouponDeps): Promise<{
  totalCoupons: number;
  activeCoupons: number;
  redemptionCount: number;
  discountedPaise: number;
}> {
  const { prisma } = deps.context;

  const [totalCoupons, activeCoupons, redemptions] = await Promise.all([
    prisma.coupon.count(),
    prisma.coupon.count({ where: { status: 'active' } }),
    prisma.couponRedemption.aggregate({
      _count: { _all: true },
      _sum: { discountPaise: true },
    }),
  ]);

  return {
    totalCoupons,
    activeCoupons,
    redemptionCount: redemptions._count._all,
    discountedPaise: redemptions._sum.discountPaise ?? 0,
  };
}

export async function getCoupon(deps: CouponDeps, couponId: string): Promise<CouponView> {
  const { prisma } = deps.context;
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });

  if (!coupon) throw notFound(couponId);

  const counts = await redemptionTotals(prisma, [coupon.id]);

  return toCouponView(coupon, counts.get(coupon.id) ?? EMPTY_COUNTS, nowOf(deps));
}

/* -------------------------------------------------------------------------- */
/* Admin — writes                                                             */
/* -------------------------------------------------------------------------- */

/** Terms that are the right shape and still nonsense become a 400, not a 500. */
function termsError(error: unknown): never {
  if (error instanceof CouponTermsError) {
    throw AppError.badRequest(error.message, {
      messageKey: 'errors.coupons.invalidTerms',
      details: { reason: error.reason },
    });
  }

  throw error;
}

export async function createCoupon(
  deps: CouponDeps,
  actor: AuditActor,
  adminId: string,
  input: CreateCouponInput,
): Promise<CouponView> {
  const { prisma } = deps.context;
  const at = nowOf(deps);

  const code = normalizeCode(input.code);
  const validFrom = new Date(input.validFrom);
  const validUntil = new Date(input.validUntil);

  try {
    assertValidTerms({
      discountType: input.discountType,
      value: input.value,
      maxDiscountPaise: input.maxDiscountPaise,
      minOrderPaise: input.minOrderPaise,
      validFrom,
      validUntil,
    });
  } catch (error) {
    termsError(error);
  }

  await assertScopeExists(prisma, input.cityId ?? null, input.categoryId ?? null);

  const created = await audited(
    prisma,
    actor,
    (coupon: Coupon) => ({
      action: AUDIT_ACTIONS.couponCreate,
      targetType: 'coupon',
      targetId: coupon.id,
      // The whole of the terms. "Somebody made a coupon" is not evidence; the
      // rate, the cap and the window are what anybody reviewing this later
      // actually needs.
      payload: {
        code: coupon.code,
        discountType: coupon.discountType,
        value: coupon.value,
        maxDiscountPaise: coupon.maxDiscountPaise,
        minOrderPaise: coupon.minOrderPaise,
        validFrom: coupon.validFrom.toISOString(),
        validUntil: coupon.validUntil.toISOString(),
        totalUsageLimit: coupon.totalUsageLimit,
        perCustomerLimit: coupon.perCustomerLimit,
        cityId: coupon.cityId,
        categoryId: coupon.categoryId,
      } satisfies Prisma.InputJsonValue,
    }),
    async (tx) => {
      try {
        return await tx.coupon.create({
          data: {
            code,
            description: input.description,
            discountType: input.discountType,
            value: input.value,
            maxDiscountPaise: input.maxDiscountPaise,
            minOrderPaise: input.minOrderPaise,
            validFrom,
            validUntil,
            totalUsageLimit: input.totalUsageLimit ?? null,
            perCustomerLimit: input.perCustomerLimit,
            cityId: input.cityId ?? null,
            categoryId: input.categoryId ?? null,
            createdByAdminId: adminId,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError(409, 'COUPON_CODE_TAKEN', `Coupon ${code} already exists`, {
            messageKey: 'errors.coupons.codeTaken',
          });
        }

        throw error;
      }
    },
  );

  return toCouponView(created, EMPTY_COUNTS, at);
}

export async function updateCoupon(
  deps: CouponDeps,
  actor: AuditActor,
  couponId: string,
  input: UpdateCouponInput,
): Promise<CouponView> {
  const { prisma } = deps.context;
  const at = nowOf(deps);

  const updated = await audited(
    prisma,
    actor,
    (result: { before: Coupon; after: Coupon }) => ({
      action: AUDIT_ACTIONS.couponUpdate,
      targetType: 'coupon',
      targetId: result.after.id,
      // Before *and* after. "The cap changed" is only meaningful next to what
      // it changed from.
      payload: {
        code: result.after.code,
        before: termsPayload(result.before),
        after: termsPayload(result.after),
      } satisfies Prisma.InputJsonValue,
    }),
    async (tx) => {
      const before = await tx.coupon.findUnique({ where: { id: couponId } });
      if (!before) throw notFound(couponId);

      const validFrom = input.validFrom ? new Date(input.validFrom) : before.validFrom;
      const validUntil = input.validUntil ? new Date(input.validUntil) : before.validUntil;

      try {
        assertValidTerms({
          // Neither the type nor the code may change — see `updateCouponSchema`.
          discountType: before.discountType,
          value: input.value ?? before.value,
          maxDiscountPaise: input.maxDiscountPaise ?? before.maxDiscountPaise,
          minOrderPaise: input.minOrderPaise ?? before.minOrderPaise,
          validFrom,
          validUntil,
        });
      } catch (error) {
        termsError(error);
      }

      if (input.cityId !== undefined || input.categoryId !== undefined) {
        await assertScopeExists(
          tx,
          input.cityId === undefined ? before.cityId : input.cityId,
          input.categoryId === undefined ? before.categoryId : input.categoryId,
        );
      }

      const after = await tx.coupon.update({
        where: { id: couponId },
        data: {
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.value === undefined ? {} : { value: input.value }),
          ...(input.maxDiscountPaise === undefined
            ? {}
            : { maxDiscountPaise: input.maxDiscountPaise }),
          ...(input.minOrderPaise === undefined ? {} : { minOrderPaise: input.minOrderPaise }),
          ...(input.validFrom === undefined ? {} : { validFrom }),
          ...(input.validUntil === undefined ? {} : { validUntil }),
          ...(input.totalUsageLimit === undefined
            ? {}
            : { totalUsageLimit: input.totalUsageLimit }),
          ...(input.perCustomerLimit === undefined
            ? {}
            : { perCustomerLimit: input.perCustomerLimit }),
          ...(input.cityId === undefined ? {} : { cityId: input.cityId }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        },
      });

      return { before, after };
    },
  );

  const counts = await redemptionTotals(prisma, [couponId]);

  return toCouponView(updated.after, counts.get(couponId) ?? EMPTY_COUNTS, at);
}

/** The subset of a coupon worth writing into an audit payload. */
function termsPayload(coupon: Coupon): Prisma.InputJsonValue {
  return {
    description: coupon.description,
    value: coupon.value,
    maxDiscountPaise: coupon.maxDiscountPaise,
    minOrderPaise: coupon.minOrderPaise,
    validFrom: coupon.validFrom.toISOString(),
    validUntil: coupon.validUntil.toISOString(),
    totalUsageLimit: coupon.totalUsageLimit,
    perCustomerLimit: coupon.perCustomerLimit,
    status: coupon.status,
    cityId: coupon.cityId,
    categoryId: coupon.categoryId,
  };
}

/**
 * Pause or resume.
 *
 * Pausing is **not** retroactive: redemptions already taken stay, and the
 * bookings that carry them keep their discount. A customer who was promised
 * ₹200 off and has it on their bill does not lose it because a campaign was
 * switched off an hour later.
 */
export async function setCouponStatus(
  deps: CouponDeps,
  actor: AuditActor,
  couponId: string,
  status: 'active' | 'paused',
): Promise<CouponView> {
  const { prisma } = deps.context;
  const at = nowOf(deps);

  const updated = await audited(
    prisma,
    actor,
    (result: { before: Coupon; after: Coupon }) => ({
      action: status === 'paused' ? AUDIT_ACTIONS.couponPause : AUDIT_ACTIONS.couponResume,
      targetType: 'coupon',
      targetId: result.after.id,
      payload: {
        code: result.after.code,
        from: result.before.status,
        to: result.after.status,
      } satisfies Prisma.InputJsonValue,
    }),
    async (tx) => {
      const before = await tx.coupon.findUnique({ where: { id: couponId } });
      if (!before) throw notFound(couponId);

      const after = await tx.coupon.update({ where: { id: couponId }, data: { status } });

      return { before, after };
    },
  );

  const counts = await redemptionTotals(prisma, [couponId]);

  return toCouponView(updated.after, counts.get(couponId) ?? EMPTY_COUNTS, at);
}

/**
 * A scope that does not exist is a coupon nobody can ever use.
 *
 * Checked up front rather than left to the foreign key, so the console gets
 * "there is no city 9" instead of a constraint name.
 */
async function assertScopeExists(
  db: PrismaClient | Prisma.TransactionClient,
  cityId: number | null,
  categoryId: number | null,
): Promise<void> {
  if (cityId !== null) {
    const city = await db.city.findUnique({ where: { id: cityId }, select: { id: true } });
    if (!city) {
      throw AppError.badRequest(`There is no city ${cityId}`, {
        messageKey: 'errors.coupons.badScope',
      });
    }
  }

  if (categoryId !== null) {
    const category = await db.category.findUnique({
      where: { id: categoryId },
      select: { id: true, cityId: true },
    });

    if (!category) {
      throw AppError.badRequest(`There is no service category ${categoryId}`, {
        messageKey: 'errors.coupons.badScope',
      });
    }

    // A category belongs to a city, so scoping to both only makes sense when
    // they agree — otherwise the coupon matches nothing and nobody finds out
    // until a customer complains it does not work.
    if (cityId !== null && category.cityId !== cityId) {
      throw AppError.badRequest(`Category ${categoryId} is not in city ${cityId}`, {
        messageKey: 'errors.coupons.badScope',
      });
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

/* -------------------------------------------------------------------------- */
/* Customer — applying and removing                                           */
/* -------------------------------------------------------------------------- */

interface CouponableBooking {
  id: string;
  customerId: string;
  categoryId: number;
  cityId: number;
  payablePaise: number;
}

/**
 * Loads a booking a coupon could attach to, or explains why not.
 *
 * A coupon is applied against the **frozen payable** — the number Phase 7 wrote
 * at the terminal transition — for the same reason Phase 8 charges that number
 * and never recomputes one: the bill was agreed, and a discount is a reduction
 * of an agreed bill, not an opportunity to re-derive it.
 */
async function loadCouponable(
  deps: CouponDeps,
  bookingId: string,
  customerId: string,
): Promise<CouponableBooking> {
  const booking = await deps.context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      customerId: true,
      categoryId: true,
      payablePaise: true,
      category: { select: { cityId: true } },
    },
  });

  if (!booking || booking.customerId !== customerId) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  const status = booking.status as BookingStatus;

  if (!isBillableBooking(status) || booking.payablePaise === null) {
    throw new AppError(409, 'BOOKING_NOT_BILLABLE', `A booking in ${status} has no bill yet`, {
      messageKey: 'errors.payments.notBillable',
      details: { status },
    });
  }

  return {
    id: booking.id,
    customerId: booking.customerId,
    categoryId: booking.categoryId,
    cityId: booking.category.cityId,
    payablePaise: booking.payablePaise,
  };
}

/**
 * Attaches a coupon to a booking.
 *
 * The whole decision — eligibility and amount — is made by `computeDiscount`,
 * which is pure and unit-tested. This function's job is only to gather the
 * inputs it needs (including the two redemption counts, read inside the
 * transaction) and to write the row.
 *
 * ## Why the counts are read inside the transaction
 *
 * Two taps in the same second on the last remaining redemption of a campaign
 * would both read `totalRedemptions = 99` outside one. Inside a transaction the
 * unique `booking_id` still guarantees one coupon per booking, but the *global*
 * limit needs the count to be taken and acted on atomically — so the read
 * happens in the same transaction as the insert, and `Serializable` is not
 * needed because the failure mode this protects against (one redemption over a
 * campaign budget) is bounded and visible, whereas a serialization retry storm
 * on every apply is not. The per-booking uniqueness — the invariant that
 * actually protects money — is a database constraint either way.
 */
export async function applyCoupon(
  deps: CouponDeps,
  customerId: string,
  bookingId: string,
  input: ApplyCouponInput,
): Promise<AppliedCouponView> {
  const { prisma } = deps.context;
  const at = nowOf(deps);

  const booking = await loadCouponable(deps, bookingId, customerId);
  const code = normalizeCode(input.code);

  try {
    return await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.findUnique({ where: { code } });

      if (!coupon) {
        throw new AppError(404, 'COUPON_NOT_FOUND', `No coupon ${code}`, {
          messageKey: REJECTION_KEYS.not_found,
          details: { reason: 'not_found' satisfies CouponRejectionReason },
        });
      }

      const [totalRedemptions, customerRedemptions] = await Promise.all([
        tx.couponRedemption.count({ where: { couponId: coupon.id } }),
        tx.couponRedemption.count({ where: { couponId: coupon.id, customerId } }),
      ]);

      const result = computeDiscount(toTerms(coupon, at), {
        orderPaise: booking.payablePaise,
        paymentMethod: input.paymentMethod as PaymentMethodChoice,
        cityId: booking.cityId,
        categoryId: booking.categoryId,
        totalRedemptions,
        customerRedemptions,
        at,
      });

      await tx.couponRedemption.create({
        data: {
          couponId: coupon.id,
          bookingId: booking.id,
          customerId,
          discountPaise: result.discountPaise,
        },
      });

      return {
        code: coupon.code,
        discountPaise: result.discountPaise,
        discountDisplay: formatPaise(result.discountPaise),
        // Restated so the customer's screen can show what the bill *was*, and
        // so nothing downstream has to reconstruct it.
        originalPayablePaise: result.providerGrossPaise,
        originalPayableDisplay: formatPaise(result.providerGrossPaise),
        payablePaise: result.payablePaise,
        payableDisplay: formatPaise(result.payablePaise),
      };
    });
  } catch (error) {
    if (error instanceof CouponRejectedError) throw rejectionToAppError(error);

    if (isUniqueViolation(error)) {
      // The unique `booking_id`. One coupon per booking, enforced by the
      // database rather than by this function remembering to check.
      throw new AppError(409, 'COUPON_ALREADY_APPLIED', 'This booking already has a coupon', {
        messageKey: 'errors.coupons.alreadyApplied',
      });
    }

    throw error;
  }
}

/**
 * Removes the coupon from a booking.
 *
 * Only before the money moves. Once a payment exists the discounted amount is
 * what the gateway order was created for, and deleting the redemption would
 * leave the technician's payout computed against a bill nobody agreed to.
 */
export async function removeCoupon(
  deps: CouponDeps,
  customerId: string,
  bookingId: string,
): Promise<void> {
  const { prisma } = deps.context;

  await loadCouponable(deps, bookingId, customerId);

  const redemption = await prisma.couponRedemption.findUnique({ where: { bookingId } });

  if (!redemption) {
    throw new AppError(404, 'COUPON_NOT_APPLIED', 'This booking has no coupon', {
      messageKey: 'errors.coupons.notApplied',
    });
  }

  const live = await prisma.payment.findFirst({
    where: { bookingId, purpose: 'final_bill', status: { in: ['created', 'captured'] } },
    select: { id: true, status: true },
  });

  if (live) {
    throw new AppError(409, 'PAYMENT_IN_PROGRESS', 'A payment for this booking is already open', {
      messageKey: 'errors.coupons.paymentOpen',
      details: { status: live.status },
    });
  }

  await prisma.couponRedemption.delete({ where: { bookingId } });
}

/* -------------------------------------------------------------------------- */
/* What the rest of the system asks about a booking's coupon                  */
/* -------------------------------------------------------------------------- */

export interface BookingDiscount {
  couponId: string;
  code: string;
  discountPaise: number;
}

/**
 * The discount attached to a booking, if any.
 *
 * The single accessor every other module uses — payments reads it to know what
 * to charge and what to post, and the booking detail reads it to render the
 * panel. Returning the stored `discountPaise` rather than recomputing from the
 * coupon's terms is deliberate: ops editing a live campaign must not silently
 * change a bill that has already been quoted to somebody.
 */
export async function findBookingDiscount(
  prisma: PrismaClient | Prisma.TransactionClient,
  bookingId: string,
): Promise<BookingDiscount | null> {
  const redemption = await prisma.couponRedemption.findUnique({
    where: { bookingId },
    select: { couponId: true, discountPaise: true, coupon: { select: { code: true } } },
  });

  if (!redemption) return null;

  return {
    couponId: redemption.couponId,
    code: redemption.coupon.code,
    discountPaise: redemption.discountPaise,
  };
}

/**
 * Drops a booking's coupon because the customer is paying cash.
 *
 * Called from the cash rail. The coupon is platform-funded out of commission,
 * which only works when the money passes through us; on cash the technician
 * hands over the discounted amount themselves while commission is computed on
 * the full price, so honouring it would take the discount out of *their*
 * earnings. Removing the redemption returns it to the campaign's budget and to
 * the customer's own allowance, which is the honest outcome — they did not use
 * it.
 */
export async function dropCouponForCash(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<BookingDiscount | null> {
  const existing = await findBookingDiscount(tx, bookingId);
  if (!existing) return null;

  await tx.couponRedemption.delete({ where: { bookingId } });

  return existing;
}
