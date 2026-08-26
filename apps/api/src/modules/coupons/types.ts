import { z } from 'zod';
import { MAX_CAP_PAISE, MAX_PERCENT, MIN_PERCENT } from './discount';

/**
 * Request and response shapes for coupons.
 *
 * The admin side is money config and is validated twice over: once here, so a
 * malformed request never reaches the service, and again in `discount.ts` by
 * `assertValidTerms` — which is also what the customer-facing path runs. Zod
 * catches the wrong *shape*; `assertValidTerms` catches terms that are the right
 * shape and still nonsense (a window that ends before it starts). The database
 * CHECKs are the third statement, and the one that cannot be bypassed.
 */

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
};

/**
 * A code as typed by a human.
 *
 * Accepted in any case and uppercased by `normalizeCode` before it is stored or
 * looked up — the poster says `DIWALI50` and the customer types `diwali50`, and
 * both have to mean the same coupon. Letters, digits, dash and underscore only:
 * a code with a space or a slash in it cannot be read out over a phone or put
 * in a URL without an argument about it.
 */
const code = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'a code may use letters, digits, dashes and underscores only');

/**
 * The coupon's terms, as the console submits them.
 *
 * `maxDiscountPaise` is **required** on create — there is no default and no
 * "leave blank for unlimited". An uncapped percentage on a large job is an
 * unbounded loss, and the cheapest place to make that impossible is the type.
 */
export const createCouponSchema = z
  .object({
    code,
    description: z.string().trim().min(3).max(200),
    discountType: z.enum(['percent', 'flat']),
    /**
     * Whole percent for `percent`, paise for `flat`. The upper bound here is the
     * looser of the two; `assertValidTerms` applies the per-type rule.
     */
    value: z.coerce.number().int().min(1).max(MAX_CAP_PAISE),
    maxDiscountPaise: z.coerce.number().int().min(1).max(MAX_CAP_PAISE),
    minOrderPaise: z.coerce.number().int().min(0).max(MAX_CAP_PAISE).default(0),
    validFrom: z.string().datetime(),
    validUntil: z.string().datetime(),
    /** Omitted means uncapped across all customers. */
    totalUsageLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
    perCustomerLimit: z.coerce.number().int().min(1).max(100).default(1),
    /** Omitted means every city / every service. */
    cityId: z.coerce.number().int().min(1).optional(),
    categoryId: z.coerce.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.discountType === 'percent' && value.value > MAX_PERCENT) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `a percent coupon must be ${MIN_PERCENT}–${MAX_PERCENT}`,
      });
    }
  });

export type CreateCouponInput = z.infer<typeof createCouponSchema>;

/**
 * An edit.
 *
 * The **code is not editable**, deliberately: it is printed on posters and sent
 * in messages, and a code that silently starts meaning something else is how a
 * customer is refused a discount they were promised. A campaign that needs a
 * different code is a different coupon.
 *
 * `discountType` is likewise fixed — changing it would reinterpret `value`,
 * turning "20 percent" into "20 paise" on a live campaign.
 */
export const updateCouponSchema = z
  .object({
    description: z.string().trim().min(3).max(200).optional(),
    value: z.coerce.number().int().min(1).max(MAX_CAP_PAISE).optional(),
    maxDiscountPaise: z.coerce.number().int().min(1).max(MAX_CAP_PAISE).optional(),
    minOrderPaise: z.coerce.number().int().min(0).max(MAX_CAP_PAISE).optional(),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    /** Explicit null clears the limit; omitted leaves it alone. */
    totalUsageLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    perCustomerLimit: z.coerce.number().int().min(1).max(100).optional(),
    cityId: z.coerce.number().int().min(1).nullable().optional(),
    categoryId: z.coerce.number().int().min(1).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

/**
 * Pause and resume, as one endpoint.
 *
 * `expired` is deliberately not settable by hand: it is a fact about the date,
 * derived on read, not an opinion ops can hold about a coupon that is still in
 * its window.
 */
export const setCouponStatusSchema = z.object({ status: z.enum(['active', 'paused']) }).strict();

export type SetCouponStatusInput = z.infer<typeof setCouponStatusSchema>;

export const listCouponsQuerySchema = z
  .object({
    ...pagination,
    status: z.enum(['active', 'paused', 'expired']).optional(),
    /** Code fragment or description. */
    q: z.string().trim().min(1).max(60).optional(),
    city_id: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export const couponIdParamSchema = z.object({ couponId: z.string().uuid() });

/** What the customer sends to attach a coupon to their booking. */
export const applyCouponSchema = z
  .object({
    code,
    /**
     * How the customer intends to pay.
     *
     * Sent explicitly rather than inferred, because at the moment a coupon is
     * applied there is usually no `payments` row yet — the choice exists only in
     * the customer's screen. Defaulting to `online` would make the cash refusal
     * depend on the client remembering to say so, so the field is required and
     * the server re-checks it at capture regardless.
     */
    paymentMethod: z.enum(['online', 'cash']),
  })
  .strict();

export type ApplyCouponInput = z.infer<typeof applyCouponSchema>;

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

/** The console's row. Money is sent as paise *and* as a formatted string. */
export interface CouponView {
  id: string;
  code: string;
  description: string;
  discountType: 'percent' | 'flat';
  value: number;
  maxDiscountPaise: number;
  maxDiscountDisplay: string;
  minOrderPaise: number;
  minOrderDisplay: string;
  validFrom: string;
  validUntil: string;
  totalUsageLimit: number | null;
  perCustomerLimit: number;
  status: 'active' | 'paused' | 'expired';
  cityId: number | null;
  categoryId: number | null;
  /** Counted from `coupon_redemptions`, never from a counter column. */
  redemptionCount: number;
  /** What this campaign has cost the platform so far, in paise. */
  discountedPaise: number;
  discountedDisplay: string;
  createdAt: string;
  updatedAt: string;
}

/** What the customer's payment panel renders once a coupon is attached. */
export interface AppliedCouponView {
  code: string;
  discountPaise: number;
  discountDisplay: string;
  /** The bill before the coupon. What the technician is paid on. */
  originalPayablePaise: number;
  originalPayableDisplay: string;
  /** What the customer now owes. */
  payablePaise: number;
  payableDisplay: string;
}
