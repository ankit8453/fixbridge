import type { Prisma, PrismaClient } from '@prisma/client';
import { formatPaise } from '../search/service';

/**
 * What a technician has actually earned, counted from the bills themselves.
 *
 * Deliberately **not** derived from the ledger, which is the other number on
 * the same screen and answers a different question. The ledger records what
 * moves between us and them: commission owed, payouts made, dues settled. At
 * the pilot's zero commission nothing moves at all, so the ledger is correctly
 * and completely empty — and a technician who has finished nine jobs opens the
 * money screen and sees nothing, which reads as "the app lost my work".
 *
 * So earnings are summed from captured payments instead. That figure is true
 * whatever the commission rate is, and it stays true when commission turns on:
 * it is the gross the customer paid, stated before any deduction, which is the
 * number a technician can check against their own memory of the week.
 *
 * Cash and online count the same. A technician who was handed notes earned
 * that money exactly as much as one whose customer paid by card, and the
 * distinction matters to our accounting, not to theirs.
 */

export interface EarningsPeriod {
  jobCount: number;
  grossPaise: number;
  grossDisplay: string;
}

export interface EarningsSummary {
  /** Monday to now, in IST — a technician's week starts on Monday. */
  thisWeek: EarningsPeriod;
  /** The first of the month to now. */
  thisMonth: EarningsPeriod;
  allTime: EarningsPeriod;
  recent: EarningsLine[];
}

export interface EarningsLine {
  bookingId: string;
  /** `cash` or the gateway method. Shown, because a technician remembers which. */
  method: string;
  grossPaise: number;
  grossDisplay: string;
  /** What the platform kept. Zero through the pilot, and shown so it stays honest. */
  commissionPaise: number;
  commissionDisplay: string;
  earnedPaise: number;
  earnedDisplay: string;
  at: string;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * India is UTC+5:30 with no daylight saving, so a fixed offset is exact rather
 * than an approximation. A technician's "this week" has to mean their week: a
 * UTC boundary rolls over at 5:30 in the morning, which puts Sunday evening's
 * work into the wrong week for anybody who worked late.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Midnight IST on the Monday of the week containing `now`, as a UTC instant. */
export function startOfWeekIst(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  // getUTCDay on the shifted clock reads the IST weekday. Sunday is 0; treat it
  // as the seventh day so the week starts on Monday.
  const weekday = ist.getUTCDay() === 0 ? 7 : ist.getUTCDay();
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnight - (weekday - 1) * 24 * 60 * 60 * 1000 - IST_OFFSET_MS);
}

/** Midnight IST on the first of the month containing `now`, as a UTC instant. */
export function startOfMonthIst(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

function period(rows: { amountPaise: number }[]): EarningsPeriod {
  const grossPaise = rows.reduce((sum, row) => sum + row.amountPaise, 0);
  return { jobCount: rows.length, grossPaise, grossDisplay: formatPaise(grossPaise) };
}

/**
 * Every captured bill for this technician's jobs.
 *
 * `final_bill` only. A visit fee collected upfront is the platform's, not
 * theirs, and counting it would overstate what they earned — which is the one
 * direction this number must never be wrong in.
 */
export async function getEarnings(
  prisma: Db,
  providerId: string,
  now: Date,
  recentLimit = 20,
): Promise<EarningsSummary> {
  const payments = await prisma.payment.findMany({
    where: {
      purpose: 'final_bill',
      status: 'captured',
      booking: { providerId },
    },
    select: {
      bookingId: true,
      method: true,
      amountPaise: true,
      commissionBpsSnapshot: true,
      capturedAt: true,
      createdAt: true,
    },
    orderBy: { capturedAt: 'desc' },
  });

  const weekStart = startOfWeekIst(now);
  const monthStart = startOfMonthIst(now);

  const at = (row: (typeof payments)[number]): Date => row.capturedAt ?? row.createdAt;

  return {
    thisWeek: period(payments.filter((row) => at(row) >= weekStart)),
    thisMonth: period(payments.filter((row) => at(row) >= monthStart)),
    allTime: period(payments),
    recent: payments.slice(0, recentLimit).map((row) => {
      /**
       * Recomputed from the rate frozen onto the payment, not from today's
       * config. A job billed at zero commission during the pilot must still
       * read as zero after the rate goes up — the alternative is a technician
       * seeing last month's earnings shrink overnight.
       */
      const commissionPaise = Math.round((row.amountPaise * row.commissionBpsSnapshot) / 10_000);
      const earnedPaise = row.amountPaise - commissionPaise;

      return {
        bookingId: row.bookingId ?? '',
        method: row.method,
        grossPaise: row.amountPaise,
        grossDisplay: formatPaise(row.amountPaise),
        commissionPaise,
        commissionDisplay: formatPaise(commissionPaise),
        earnedPaise,
        earnedDisplay: formatPaise(earnedPaise),
        at: at(row).toISOString(),
      };
    }),
  };
}
