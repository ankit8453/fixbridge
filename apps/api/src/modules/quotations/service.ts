import type { Prisma } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { formatPaise } from '../search/service';
import { topicFor } from '../bookings/state-machine';
import type { BookingStatus } from '../bookings/state-machine';
import { computeQuotationTotals, QuotationMathError } from './money';
import { assertAgreedMatches, assertNotBelowFloor, decideLabour, LabourRuleError } from './labour';
import * as repo from './repository';
import type { QuotationWithItems } from './repository';
import type {
  CreateQuotationInput,
  QuotationHistoryResponse,
  QuotationView,
  RejectQuotationInput,
} from './types';

export interface QuotationDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: QuotationDeps): Date => (deps.now ? deps.now() : new Date());

const notFound = (id: string): AppError =>
  new AppError(404, 'QUOTATION_NOT_FOUND', `Quotation ${id} not found`, {
    messageKey: 'errors.quotations.notFound',
  });

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/* -------------------------------------------------------------------------- */

interface BookingContext {
  id: string;
  status: BookingStatus;
  customerId: string;
  providerId: string;
  categoryId: number;
  /** The booking-time price snapshot the labour rules check against. */
  priceCardType: PriceType | null;
  priceCardAmountPaise: number | null;
}

/**
 * Loads the booking and establishes which side the caller is on.
 *
 * `404` for a stranger, never `403`: someone who is on neither side of a booking
 * should not learn it exists. Same rule as Phase 6.
 */
async function loadBooking(
  deps: QuotationDeps,
  bookingId: string,
  userId: string,
): Promise<{ booking: BookingContext; side: 'customer' | 'provider' }> {
  const booking = await deps.context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      customerId: true,
      providerId: true,
      categoryId: true,
      // The price the customer actually agreed to. Without these two the
      // labour rules have no anchor to check a quote against.
      priceCardType: true,
      priceCardAmountPaise: true,
    },
  });

  if (!booking || (booking.customerId !== userId && booking.providerId !== userId)) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  return {
    booking: { ...booking, status: booking.status as BookingStatus },
    side: booking.customerId === userId ? 'customer' : 'provider',
  };
}

/**
 * Pricing is negotiated while the technician is there and the job is open.
 *
 * Before `IN_PROGRESS` there is nothing to quote — the technician has not seen
 * the fault. After it, the job is over and a price would be a renegotiation of
 * something already settled.
 */
function requireInProgress(booking: BookingContext): void {
  if (booking.status !== 'IN_PROGRESS') {
    throw new AppError(
      409,
      'QUOTATION_NOT_ALLOWED',
      `A booking in ${booking.status} cannot be quoted`,
      {
        messageKey: 'errors.quotations.notInProgress',
        details: { status: booking.status },
      },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

export function toQuotationView(quotation: QuotationWithItems): QuotationView {
  return {
    id: quotation.id,
    bookingId: quotation.bookingId,
    version: quotation.version,
    status: quotation.status,
    labourPaise: quotation.labourPaise,
    partsTotalPaise: quotation.partsTotalPaise,
    totalPaise: quotation.totalPaise,
    totalDisplay: formatPaise(quotation.totalPaise),
    note: quotation.note,
    decisionNote: quotation.decisionNote,
    items: quotation.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      description: item.description,
      qty: item.qty,
      unitPaise: item.unitPaise,
      lineTotalPaise: item.lineTotalPaise,
    })),
    decidedAt: quotation.decidedAt?.toISOString() ?? null,
    createdAt: quotation.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Send                                                                       */
/* -------------------------------------------------------------------------- */

export async function sendQuotation(
  deps: QuotationDeps,
  providerId: string,
  bookingId: string,
  input: CreateQuotationInput,
): Promise<QuotationView> {
  const { booking, side } = await loadBooking(deps, bookingId, providerId);

  if (side !== 'provider') {
    throw new AppError(
      403,
      'QUOTATION_WRONG_ACTOR',
      'Only the assigned technician may send a quotation',
      {
        messageKey: 'errors.quotations.providerOnly',
      },
    );
  }

  requireInProgress(booking);

  // An approved price is final. A revision after agreement is a new job, not a
  // new version — and letting one through would make "agreed in writing" empty.
  const live = await repo.summariseLiveQuotation(deps.context.prisma, bookingId);

  if (live.approvedId) {
    throw new AppError(
      409,
      'QUOTATION_ALREADY_APPROVED',
      'This booking already has an approved price',
      {
        messageKey: 'errors.quotations.alreadyApproved',
      },
    );
  }

  const totals = totalsOrBadRequest(input);

  /**
   * Labour is checked against what the customer actually agreed to.
   *
   * The booking snapshots the price card at booking time; before this, nothing
   * consulted it and a technician listed at ₹300 could quote ₹500. The agreed
   * portion is DERIVED here rather than trusted from the request — a partner
   * app is not a trust boundary.
   */
  const labour = labourOrBadRequest(booking, input);

  const payload = {
    agreedLabourPaise: labour.agreedLabourPaise,
    extraLabourPaise: labour.extraLabourPaise,
    needsReview: labour.needsReview,
    labourPaise: labour.totalLabourPaise,
    partsTotalPaise: totals.partsTotalPaise,
    totalPaise: totals.totalPaise,
    itemCount: input.items.length,
  } satisfies Prisma.InputJsonValue;

  try {
    const created = await repo.createQuotationWithSupersede(
      deps.context.prisma,
      {
        bookingId,
        createdById: providerId,
        agreedLabourPaise: labour.agreedLabourPaise,
        extraLabourPaise: labour.extraLabourPaise,
        extraLabourReason: labour.extraLabourReason,
        needsReview: labour.needsReview,
        labourPaise: labour.totalLabourPaise,
        partsTotalPaise: totals.partsTotalPaise,
        totalPaise: totals.totalPaise,
        note: input.note ?? null,
        items: input.items.map((item, index) => ({
          kind: item.kind,
          description: item.description,
          qty: item.qty,
          unitPaise: item.unitPaise,
          lineTotalPaise: totals.lineTotals[index] as number,
        })),
      },
      (quotation) => ({
        eventType: 'quote_sent',
        actorType: 'provider',
        actorUserId: providerId,
        topic: topicFor('quote_sent'),
        payload: { ...payload, quotationId: quotation.id, version: quotation.version },
      }),
    );

    return toQuotationView(created);
  } catch (error) {
    if (repo.isLiveQuotationConflict(error)) {
      // Two devices, one technician, or an approval that landed first.
      throw new AppError(
        409,
        'QUOTATION_CONFLICT',
        'That quotation was overtaken; reload and try again',
        {
          messageKey: 'errors.quotations.conflict',
        },
      );
    }

    throw error;
  }
}

/**
 * Applies the labour rules and turns a rule violation into a 400.
 *
 * Backwards-compatible with a client that still sends only `labourPaise`: when
 * no explicit split is supplied, whatever exceeds the agreed amount is treated
 * as extra — which then requires a reason, exactly as a deliberate split would.
 */
function labourOrBadRequest(
  booking: { priceCardType: PriceType | null; priceCardAmountPaise: number | null },
  input: CreateQuotationInput,
) {
  const anchor = {
    priceType: booking.priceCardType,
    amountPaise: booking.priceCardAmountPaise,
  };

  try {
    const explicit = input.extraLabourPaise !== undefined;

    if (explicit && input.agreedLabourPaise !== undefined) {
      assertAgreedMatches(anchor, input.agreedLabourPaise);
    }

    const decision = decideLabour({
      anchor,
      extraLabourPaise: explicit
        ? (input.extraLabourPaise as number)
        : deriveExtra(anchor, input.labourPaise),
      extraLabourReason: input.extraLabourReason ?? null,
      unanchoredLabourPaise: input.labourPaise,
    });

    assertNotBelowFloor(anchor, decision.totalLabourPaise);

    return decision;
  } catch (error) {
    if (error instanceof LabourRuleError) {
      throw new AppError(400, 'QUOTATION_LABOUR_INVALID', error.message, {
        messageKey: `errors.quotations.labour.${error.reason}`,
        details: { reason: error.reason, expectedPaise: error.expectedPaise },
      });
    }
    throw error;
  }
}

/** Whatever a legacy single-figure request charges above the agreed amount. */
function deriveExtra(
  anchor: { priceType: PriceType | null; amountPaise: number | null },
  labourPaise: number,
): number {
  const agreed =
    anchor.amountPaise !== null &&
    (anchor.priceType === 'fixed' || anchor.priceType === 'starting_from')
      ? anchor.amountPaise
      : 0;
  return Math.max(0, labourPaise - agreed);
}

/** Zod has already checked shapes; this catches arithmetic the caps forbid. */
function totalsOrBadRequest(input: CreateQuotationInput) {
  try {
    return computeQuotationTotals(input.labourPaise, input.items);
  } catch (error) {
    if (error instanceof QuotationMathError) {
      throw AppError.badRequest(error.message, {
        messageKey: `errors.quotations.math.${error.reason}`,
        details: { reason: error.reason },
      });
    }

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

type Decision = 'approved' | 'rejected' | 'withdrawn';

const DECISION_EVENT = {
  approved: 'quote_approved',
  rejected: 'quote_rejected',
  withdrawn: 'quote_withdrawn',
} as const;

async function decide(
  deps: QuotationDeps,
  userId: string,
  quotationId: string,
  decision: Decision,
  reason: string | null,
): Promise<QuotationView> {
  const quotation = await repo.findQuotation(deps.context.prisma, quotationId);
  if (!quotation) throw notFound(quotationId);

  const { booking, side } = await loadBooking(deps, quotation.bookingId, userId);

  // Withdrawing is the technician's own correction; deciding is the customer's.
  const requiredSide = decision === 'withdrawn' ? 'provider' : 'customer';

  if (side !== requiredSide) {
    throw new AppError(403, 'QUOTATION_WRONG_ACTOR', `Only the ${requiredSide} may do this`, {
      messageKey:
        requiredSide === 'provider'
          ? 'errors.quotations.providerOnly'
          : 'errors.quotations.customerOnly',
    });
  }

  if (quotation.status !== 'sent') {
    throw new AppError(409, 'QUOTATION_NOT_PENDING', `Quotation is already ${quotation.status}`, {
      messageKey: 'errors.quotations.notPending',
      details: { status: quotation.status },
    });
  }

  requireInProgress(booking);

  try {
    const updated = await repo.decideQuotation(
      deps.context.prisma,
      quotationId,
      decision,
      decision === 'rejected' ? reason : null,
      {
        bookingId: quotation.bookingId,
        eventType: DECISION_EVENT[decision],
        actorType: requiredSide,
        actorUserId: userId,
        topic: topicFor(DECISION_EVENT[decision]),
        payload: {
          quotationId,
          version: quotation.version,
          totalPaise: quotation.totalPaise,
          ...(decision === 'rejected' && reason ? { reason } : {}),
        },
      },
      nowOf(deps),
    );

    return toQuotationView(updated);
  } catch (error) {
    if (error instanceof repo.QuotationRaceLostError) {
      throw new AppError(409, 'QUOTATION_NOT_PENDING', 'That quotation was already decided', {
        messageKey: 'errors.quotations.notPending',
      });
    }

    throw error;
  }
}

export function approveQuotation(
  deps: QuotationDeps,
  customerId: string,
  quotationId: string,
): Promise<QuotationView> {
  return decide(deps, customerId, quotationId, 'approved', null);
}

export function rejectQuotation(
  deps: QuotationDeps,
  customerId: string,
  quotationId: string,
  input: RejectQuotationInput,
): Promise<QuotationView> {
  return decide(deps, customerId, quotationId, 'rejected', input.reason ?? null);
}

export function withdrawQuotation(
  deps: QuotationDeps,
  providerId: string,
  quotationId: string,
): Promise<QuotationView> {
  return decide(deps, providerId, quotationId, 'withdrawn', null);
}

/* -------------------------------------------------------------------------- */
/* History                                                                    */
/* -------------------------------------------------------------------------- */

export async function listQuotations(
  deps: QuotationDeps,
  userId: string,
  bookingId: string,
): Promise<QuotationHistoryResponse> {
  await loadBooking(deps, bookingId, userId);

  const rows = await repo.listQuotationsForBooking(deps.context.prisma, bookingId);
  const quotations = rows.map(toQuotationView);

  return {
    bookingId,
    quotations,
    pending: quotations.find((quote) => quote.status === 'sent') ?? null,
    approved: quotations.find((quote) => quote.status === 'approved') ?? null,
  };
}
