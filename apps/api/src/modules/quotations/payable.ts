import type { BookingStatus } from '../bookings/state-machine';

/**
 * What the customer owes, and why.
 *
 * This function is the contract between Phase 7 and Phase 8: its output is
 * frozen onto the booking at the terminal transition and Phase 8 charges that
 * number. It never looks anything up — every input is passed in — so it can be
 * tested exhaustively against hand-computed fixtures, which is the only
 * acceptable standard for code that decides what a person pays.
 *
 * ## The visit-fee rule, in one sentence
 *
 * > The visit fee is the price of the technician turning up, so it is **waived**
 * > whenever the job is priced and done under an approved quotation, and
 * > **charged** whenever the customer sends the technician away or the job is
 * > billed at a flat price-card rate.
 *
 * The asymmetry is deliberate. A customer who accepts a quote has already paid
 * for the trip inside the quote — charging it twice would make the itemised
 * total a lie, which is the exact thing this feature exists to prevent. A
 * customer who hears the price and declines has still consumed a visit, and a
 * technician who travelled across Jabalpur for nothing must not absorb that.
 */

export type PayableComponentKind = 'quotation' | 'price_card' | 'visit_fee';

export interface PayableComponent {
  kind: PayableComponentKind;
  /** i18n key, rendered per Accept-Language. Never display text. */
  labelKey: string;
  amountPaise: number;
  /** Present and zero-amount when the fee was waived, so the waiver is visible. */
  waived?: boolean;
}

export interface PayableBreakdown {
  payablePaise: number;
  visitFeeCharged: boolean;
  components: PayableComponent[];
  /** Which path produced this number. Phase 8 and ops both read it. */
  basis: 'approved_quotation' | 'price_card' | 'visit_fee_only';
}

export interface PayableInput {
  /** The status the booking has just reached. */
  outcome: BookingStatus;
  /** Snapshotted at creation from `fee_config`. */
  visitFeePaise: number;
  /** Total of the approved quotation, when there is one. */
  approvedQuoteTotalPaise: number | null;
  /** The price card the booking was made against, if any. */
  priceCard: {
    priceType: 'fixed' | 'starting_from' | 'inspection_based';
    amountPaise: number | null;
  } | null;
}

/** A terminal status that owes nothing at all. */
export class NotBillableError extends Error {
  constructor(readonly status: BookingStatus) {
    super(`${status} is not a billable outcome`);
    this.name = 'NotBillableError';
  }
}

/** No agreed price exists, so no honest number can be produced. */
export class NoAgreedPriceError extends Error {
  constructor() {
    super('the booking has neither an approved quotation nor a fixed price card');
    this.name = 'NoAgreedPriceError';
  }
}

const VISIT_FEE_LABEL = 'payable.visitFee';

/**
 * The whole pricing decision, in one place.
 *
 * Three cases and no fourth. If a caller reaches the throw at the end, a guard
 * upstream failed — and failing loudly beats inventing a number.
 */
export function computePayable(input: PayableInput): PayableBreakdown {
  if (input.outcome === 'CLOSED_QUOTE_DECLINED') {
    // The visit happened. Nothing was fixed, so nothing else is owed.
    return {
      payablePaise: input.visitFeePaise,
      visitFeeCharged: true,
      basis: 'visit_fee_only',
      components: [
        { kind: 'visit_fee', labelKey: VISIT_FEE_LABEL, amountPaise: input.visitFeePaise },
      ],
    };
  }

  if (input.outcome !== 'WORK_DONE') {
    throw new NotBillableError(input.outcome);
  }

  if (input.approvedQuoteTotalPaise !== null) {
    // Priced in writing and agreed. The trip is inside that number already.
    return {
      payablePaise: input.approvedQuoteTotalPaise,
      visitFeeCharged: false,
      basis: 'approved_quotation',
      components: [
        {
          kind: 'quotation',
          labelKey: 'payable.approvedQuotation',
          amountPaise: input.approvedQuoteTotalPaise,
        },
        // Listed at zero rather than omitted: a customer who was told there is a
        // visit fee should be able to see that it was not charged.
        { kind: 'visit_fee', labelKey: VISIT_FEE_LABEL, amountPaise: 0, waived: true },
      ],
    };
  }

  const flat =
    input.priceCard && input.priceCard.priceType === 'fixed' && input.priceCard.amountPaise !== null
      ? input.priceCard.amountPaise
      : null;

  if (flat === null) {
    // `starting_from` and `inspection_based` are estimates, not agreements. The
    // WORK_DONE guard should have refused long before here.
    throw new NoAgreedPriceError();
  }

  return {
    payablePaise: flat + input.visitFeePaise,
    visitFeeCharged: true,
    basis: 'price_card',
    components: [
      { kind: 'price_card', labelKey: 'payable.priceCard', amountPaise: flat },
      { kind: 'visit_fee', labelKey: VISIT_FEE_LABEL, amountPaise: input.visitFeePaise },
    ],
  };
}

/**
 * Every breakdown must add up. Cheap, and it runs on every terminal transition.
 *
 * Belt and braces over the DB CHECKs: those guard a quotation's internal
 * arithmetic, this guards the assembly of the final bill.
 */
export function assertBreakdownAddsUp(breakdown: PayableBreakdown): void {
  const sum = breakdown.components.reduce((total, part) => total + part.amountPaise, 0);

  if (sum !== breakdown.payablePaise) {
    throw new Error(
      `payable breakdown does not add up: components sum to ${sum} but payable is ${breakdown.payablePaise}`,
    );
  }
}
