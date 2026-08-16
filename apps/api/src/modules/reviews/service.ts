import type { Prisma, Review } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { enqueueOutbox } from '../../core/outbox';
import { TRUST_TOPICS } from '../trust/topics';
import {
  tagsFor,
  type CreateReviewInput,
  type ListReviewsQuery,
  type ProviderReviewsResponse,
  type PublicReviewView,
  type ReviewView,
} from './types';
import { writeDepsAudit, type AuditableDeps } from '../../core/audit';

/**
 * Reviews.
 *
 * ## Gated on money
 *
 * A review may only be written for a booking that was **done and paid for**. Not
 * "completed" — paid. That single rule removes the entire class of fake reviews
 * that costs marketplaces their credibility: to leave one you must have booked a
 * real technician, had them turn up, and parted with real money. It also means a
 * customer who never paid cannot use a one-star review as leverage.
 *
 * ## Asymmetric visibility
 *
 * Customer→provider reviews are public. Provider→customer reviews are internal:
 * ops can read them, the trust engine ignores them, and no endpoint in this
 * codebase returns one to a member of the public. A technician needs somewhere
 * to record "this address was not safe to enter" without starting a public
 * argument with somebody who can rate them back.
 */

export interface ReviewDeps extends AuditableDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: ReviewDeps): Date => (deps.now ? deps.now() : new Date());

export function toReviewView(review: Review): ReviewView {
  return {
    id: review.id,
    bookingId: review.bookingId,
    direction: review.direction,
    stars: review.stars,
    tags: review.tags,
    text: review.text,
    status: review.status,
    createdAt: review.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                */
/* -------------------------------------------------------------------------- */

interface Reviewable {
  bookingId: string;
  direction: 'customer_to_provider' | 'provider_to_customer';
  authorUserId: string;
  subjectUserId: string;
  settledAt: Date;
}

/**
 * Establishes that this person may review this booking, right now.
 *
 * Four things have to hold, and each is its own answer: the caller is a party to
 * the booking, the job finished, the money settled, and the window is still
 * open.
 */
async function loadReviewable(
  deps: ReviewDeps,
  bookingId: string,
  userId: string,
): Promise<Reviewable> {
  const { context } = deps;

  const booking = await context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      customerId: true,
      providerId: true,
      payments: {
        where: { status: { in: ['captured', 'partially_refunded', 'refunded'] } },
        select: { capturedAt: true, method: true },
        orderBy: { capturedAt: 'asc' },
        take: 1,
      },
    },
  });

  const side =
    booking && booking.customerId === userId
      ? 'customer'
      : booking && booking.providerId === userId
        ? 'provider'
        : null;

  if (!booking || !side) {
    // 404 for a stranger: whether these two people did business is not their
    // information.
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  if (booking.status !== 'WORK_DONE') {
    throw new AppError(
      403,
      'REVIEW_NOT_ALLOWED',
      `A booking in ${booking.status} cannot be rated`,
      {
        messageKey: 'errors.reviews.notCompleted',
        details: { status: booking.status },
      },
    );
  }

  const settlement = booking.payments[0];

  if (!settlement?.capturedAt) {
    // The gate that matters. No money, no review.
    throw new AppError(403, 'REVIEW_NOT_ALLOWED', 'This booking has not been paid for', {
      messageKey: 'errors.reviews.notPaid',
    });
  }

  const windowDays = context.config.REVIEW_WINDOW_DAYS;
  const closesAt = new Date(settlement.capturedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

  if (nowOf(deps).getTime() > closesAt.getTime()) {
    throw new AppError(
      403,
      'REVIEW_WINDOW_CLOSED',
      `Reviews close ${windowDays} days after payment`,
      {
        messageKey: 'errors.reviews.windowClosed',
        details: { closedAt: closesAt.toISOString() },
      },
    );
  }

  return side === 'customer'
    ? {
        bookingId,
        direction: 'customer_to_provider',
        authorUserId: booking.customerId,
        subjectUserId: booking.providerId,
        settledAt: settlement.capturedAt,
      }
    : {
        bookingId,
        direction: 'provider_to_customer',
        authorUserId: booking.providerId,
        subjectUserId: booking.customerId,
        settledAt: settlement.capturedAt,
      };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export async function createReview(
  deps: ReviewDeps,
  userId: string,
  bookingId: string,
  input: CreateReviewInput,
): Promise<ReviewView> {
  const { context } = deps;
  const target = await loadReviewable(deps, bookingId, userId);

  // Tags belong to a direction. A customer cannot mark somebody `difficult`, and
  // a technician cannot mark somebody `punctual` — the words mean different
  // things about different people.
  const allowed = new Set<string>(tagsFor(target.direction));
  const wrong = input.tags.filter((tag) => !allowed.has(tag));

  if (wrong.length > 0) {
    throw AppError.badRequest(`Those tags do not apply here: ${wrong.join(', ')}`, {
      messageKey: 'errors.reviews.badTags',
      details: { allowed: [...allowed] },
    });
  }

  try {
    const review = await context.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          bookingId,
          direction: target.direction,
          authorUserId: target.authorUserId,
          subjectUserId: target.subjectUserId,
          stars: input.stars,
          tags: [...new Set(input.tags)],
          text: input.text ?? null,
        },
      });

      /**
       * The trust engine subscribes to this. The payload carries the subject so
       * the consumer does not have to guess which side of the booking changed —
       * a provider→customer review must not rescore the technician.
       */
      await enqueueOutbox(tx, {
        topic: TRUST_TOPICS.reviewCreated,
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: {
          reviewId: created.id,
          direction: created.direction,
          stars: created.stars,
          // Only a customer→provider review has a technician to rescore.
          ...(created.direction === 'customer_to_provider'
            ? { providerId: created.subjectUserId }
            : {}),
        } satisfies Prisma.InputJsonValue,
      });

      return created;
    });

    return toReviewView(review);
  } catch (error) {
    if (isDuplicateReview(error)) {
      throw new AppError(409, 'REVIEW_ALREADY_EXISTS', 'You have already reviewed this booking', {
        messageKey: 'errors.reviews.alreadyExists',
      });
    }

    throw error;
  }
}

function isDuplicateReview(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (code !== 'P2002') return false;

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];

  return fields.some((field) => field.includes('booking_id') || field.includes('reviews'));
}

/** Flags a review for ops. Phase 11 builds the queue; this records the flag. */
export async function reportReview(
  deps: ReviewDeps,
  reporterUserId: string,
  reviewId: string,
  reason: string,
): Promise<{ reported: true }> {
  const { context } = deps;

  const review = await context.prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, direction: true, status: true },
  });

  // A provider→customer review is not public, so it cannot be reported by the
  // public either — and saying "not found" avoids confirming one exists.
  if (!review || review.direction !== 'customer_to_provider') {
    throw new AppError(404, 'REVIEW_NOT_FOUND', `Review ${reviewId} not found`, {
      messageKey: 'errors.reviews.notFound',
    });
  }

  await context.prisma.reviewReport.upsert({
    where: { reviewId_reporterUserId: { reviewId, reporterUserId } },
    update: { reason },
    create: { reviewId, reporterUserId, reason },
  });

  await context.prisma.$transaction(async (tx) => {
    await enqueueOutbox(tx, {
      topic: TRUST_TOPICS.reviewReported,
      aggregateType: 'review',
      aggregateId: reviewId,
      payload: { reporterUserId, reason },
    });
  });

  return { reported: true };
}

/**
 * Ops moderation. Hides a review and rescores without it.
 *
 * **Hidden reviews are excluded from every aggregate**, because the recompute
 * simply does not select them — there is no separate "remove from average" step
 * to forget. The row survives: deleting the evidence of a moderation decision is
 * its own kind of dishonesty, and a technician disputing one needs it to exist.
 */
export async function setReviewHidden(
  deps: ReviewDeps,
  reviewId: string,
  hidden: boolean,
): Promise<ReviewView> {
  const { context } = deps;

  const review = await context.prisma.review.findUnique({ where: { id: reviewId } });

  if (!review) {
    throw new AppError(404, 'REVIEW_NOT_FOUND', `Review ${reviewId} not found`, {
      messageKey: 'errors.reviews.notFound',
    });
  }

  const updated = await context.prisma.$transaction(async (tx) => {
    // The ops audit row, in the same transaction as the decision it records.
    await writeDepsAudit(tx, deps);

    const moved = await tx.review.update({
      where: { id: reviewId },
      data: { status: hidden ? 'hidden' : 'published' },
    });

    await enqueueOutbox(tx, {
      topic: TRUST_TOPICS.reviewHidden,
      aggregateType: 'booking',
      aggregateId: review.bookingId,
      payload: {
        reviewId,
        hidden,
        ...(review.direction === 'customer_to_provider'
          ? { providerId: review.subjectUserId }
          : {}),
      },
    });

    return moved;
  });

  return toReviewView(updated);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A technician's public reviews.
 *
 * Filtered on **direction and status in the query**, not after it, so there is
 * no code path where a provider→customer review or a hidden one could reach a
 * response by accident. Ownership and visibility enforced in the query is the
 * same discipline the `/me` routes have used since Phase 3.
 */
export async function listPublicReviews(
  deps: ReviewDeps,
  providerId: string,
  query: ListReviewsQuery,
): Promise<ProviderReviewsResponse> {
  const { context } = deps;
  const where = {
    subjectUserId: providerId,
    direction: 'customer_to_provider' as const,
    status: 'published' as const,
  };

  const [rows, total, stats] = await Promise.all([
    context.prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        stars: true,
        tags: true,
        text: true,
        createdAt: true,
        author: { select: { name: true } },
      },
    }),
    context.prisma.review.count({ where }),
    context.prisma.providerStats.findUnique({
      where: { providerId },
      select: { avgStars: true, reviewCount: true, tagCounts: true },
    }),
  ]);

  const reviews: PublicReviewView[] = rows.map((row) => ({
    id: row.id,
    stars: row.stars,
    tags: row.tags,
    text: row.text,
    authorName: shortenName(row.author.name),
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    providerId,
    averageStars: stats?.avgStars ?? null,
    reviewCount: stats?.reviewCount ?? total,
    tagCounts: (stats?.tagCounts as Record<string, number> | null) ?? {},
    reviews,
    page: query.page,
    pageSize: query.page_size,
    total,
  };
}

/**
 * "Priya S." — a person, not a database row, and not findable.
 *
 * A full name on a public page is a real safety problem for somebody who has had
 * a stranger in their home, and an anonymous score reads as fake. First name and
 * an initial is the compromise every marketplace lands on for good reason.
 */
export function shortenName(name: string | null): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return 'A customer';

  const [first, ...rest] = trimmed.split(/\s+/);
  const surname = rest.at(-1);

  return surname ? `${first} ${surname.charAt(0).toUpperCase()}.` : (first as string);
}

/** Both of a booking's reviews, to its own two parties. */
export async function listBookingReviews(
  deps: ReviewDeps,
  userId: string,
  bookingId: string,
): Promise<ReviewView[]> {
  const booking = await deps.context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { customerId: true, providerId: true },
  });

  if (!booking || (booking.customerId !== userId && booking.providerId !== userId)) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  const reviews = await deps.context.prisma.review.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
  });

  return reviews.map(toReviewView);
}
