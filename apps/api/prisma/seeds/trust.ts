import type { PrismaClient } from '@prisma/client';
import { computeBadgeBand, computeTrustScore } from '../../src/modules/trust/score';
import { deterministicUuid } from './deterministic-id';

/**
 * Reviews, complaints and trust snapshots.
 *
 * The distribution is chosen so the search tests have something to sort: one
 * technician in SILVER, one in GOLD, one suspended, and the rest unrated. That
 * is roughly what a real young marketplace looks like — a handful with a track
 * record and a long tail with none — and it means a locally-run search returns a
 * list that actually differs rather than a wall of identical cards.
 *
 * Every number here comes from the same pure functions the engine uses, so a
 * seeded score and a live one cannot disagree.
 */

const WEIGHTS = {
  rating: 35,
  acceptance: 20,
  reliability: 20,
  complaints: 15,
  recency: 10,
  ratingHalfLifeDays: 90,
  recencyHalfLifeDays: 90,
  complaintZeroAt: 6,
};

const THRESHOLDS = { silverScore: 70, silverJobs: 10, goldScore: 85, goldJobs: 30 };

interface ReviewSeed {
  bookingKey: string;
  direction: 'customer_to_provider' | 'provider_to_customer';
  stars: number;
  tags: string[];
  text?: string;
  /** Days before "now". Lets the decay curve actually show up locally. */
  daysAgo: number;
}

/**
 * Reviews on the seeded settled bookings.
 *
 * Both directions on one booking, so the asymmetric-visibility test has a real
 * provider→customer row to try (and fail) to leak.
 */
const REVIEW_SEEDS: ReviewSeed[] = [
  {
    bookingKey: 'completed',
    direction: 'customer_to_provider',
    stars: 5,
    tags: ['punctual', 'clean_work'],
    text: 'Came on time, tidied up after. No complaints at all.',
    daysAgo: 2,
  },
  {
    bookingKey: 'completed',
    direction: 'provider_to_customer',
    stars: 5,
    tags: ['clear_problem', 'paid_promptly'],
    text: 'Explained the fault clearly. Paid on the spot.',
    daysAgo: 2,
  },
  {
    bookingKey: 'completed-via-quote',
    direction: 'customer_to_provider',
    stars: 4,
    tags: ['expert', 'fair_price'],
    text: 'Knew exactly what was wrong. Slightly late but called ahead.',
    daysAgo: 4,
  },
  {
    bookingKey: 'completed-after-revision',
    direction: 'customer_to_provider',
    stars: 5,
    tags: ['fair_price', 'polite'],
    text: 'Found a cheaper part when I said the first quote was too much.',
    daysAgo: 5,
  },
  {
    bookingKey: 'completed-after-otp-retry',
    direction: 'customer_to_provider',
    stars: 3,
    tags: ['expert'],
    text: 'Work is fine. Took two attempts to get the code right at the door.',
    daysAgo: 3,
  },
];

interface ComplaintSeed {
  bookingKey: string;
  category: 'overcharge' | 'no_show' | 'quality' | 'behavior' | 'cash_dispute' | 'safety' | 'other';
  description: string;
  /** `open` leaves it in the ops queue; `resolved` counts against the technician. */
  outcome: 'open' | 'resolved_minor';
}

const COMPLAINT_SEEDS: ComplaintSeed[] = [
  {
    bookingKey: 'completed-after-otp-retry',
    category: 'quality',
    description: 'The AC cooled well for two days and then went back to how it was before.',
    outcome: 'resolved_minor',
  },
  {
    bookingKey: 'completed-via-quote',
    category: 'overcharge',
    description: 'I was charged for a part that I think was already replaced last year.',
    outcome: 'open',
  },
];

export interface TrustSeedSummary {
  reviews: number;
  complaints: number;
  snapshots: number;
  suspended: number;
}

export async function seedTrust(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<TrustSeedSummary> {
  const reviews = await seedReviews(prisma, now);
  const complaints = await seedComplaints(prisma, now);
  const suspended = await seedSuspension(prisma, now);
  const { snapshots, bands } = await seedSnapshots(prisma, now);

  console.log(
    `trust ready: ${reviews} reviews, ${complaints} complaints, ${snapshots} snapshots ` +
      `(${bands.SILVER} silver, ${bands.GOLD} gold), ${suspended} suspended`,
  );

  return { reviews, complaints, snapshots, suspended };
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* -------------------------------------------------------------------------- */

async function seedReviews(prisma: PrismaClient, now: Date): Promise<number> {
  let created = 0;

  for (const seed of REVIEW_SEEDS) {
    const bookingId = deterministicUuid(`booking:${seed.bookingKey}`);
    const id = deterministicUuid(`review:${seed.bookingKey}:${seed.direction}`);

    if (await prisma.review.findUnique({ where: { id }, select: { id: true } })) continue;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true, providerId: true },
    });

    if (!booking) continue;

    const isCustomerReview = seed.direction === 'customer_to_provider';

    await prisma.review.create({
      data: {
        id,
        bookingId,
        direction: seed.direction,
        authorUserId: isCustomerReview ? booking.customerId : booking.providerId,
        subjectUserId: isCustomerReview ? booking.providerId : booking.customerId,
        stars: seed.stars,
        tags: seed.tags,
        text: seed.text ?? null,
        createdAt: new Date(now.getTime() - seed.daysAgo * 24 * 60 * 60 * 1000),
      },
    });

    created += 1;
  }

  return created;
}

/* -------------------------------------------------------------------------- */
/* Complaints                                                                 */
/* -------------------------------------------------------------------------- */

async function seedComplaints(prisma: PrismaClient, now: Date): Promise<number> {
  const ops = await prisma.user.findFirst({
    where: { roles: { some: { role: 'ops' } } },
    select: { id: true },
  });

  let created = 0;

  for (const seed of COMPLAINT_SEEDS) {
    const bookingId = deterministicUuid(`booking:${seed.bookingKey}`);
    const id = deterministicUuid(`complaint:${seed.bookingKey}`);

    if (await prisma.complaint.findUnique({ where: { id }, select: { id: true } })) continue;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true, providerId: true },
    });

    if (!booking) continue;

    const resolved = seed.outcome === 'resolved_minor';
    const resolvedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await prisma.complaint.create({
      data: {
        id,
        bookingId,
        raisedByUserId: booking.customerId,
        againstUserId: booking.providerId,
        category: seed.category,
        description: seed.description,
        status: resolved ? 'resolved' : 'open',
        ...(resolved
          ? {
              resolutionNote: 'Technician returned and re-gassed the unit at no charge.',
              severityOnResolution: 'minor' as const,
              resolvedByUserId: ops?.id ?? null,
              resolvedAt,
            }
          : {}),
        createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    created += 1;
  }

  return created;
}

/* -------------------------------------------------------------------------- */
/* A suspended technician                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One technician suspended for repeat cancellations.
 *
 * The search-gate tests need somebody who passes every *other* gate — listed,
 * verified, active — and is still invisible, otherwise "suspended is excluded"
 * could pass for the wrong reason.
 */
async function seedSuspension(prisma: PrismaClient, now: Date): Promise<number> {
  /**
   * Shabana Bano — chosen carefully.
   *
   * She has to be **verified and listed**, or suspending her would prove
   * nothing: the gate test needs somebody who passes every other check and is
   * still invisible. She also must not be a technician the Phase 5 tests name by
   * hand (Golu Rajak) or a band-holder the Phase 9 ones rely on.
   */
  const target = await prisma.user.findUnique({
    where: { phone: '+919000000012' },
    select: { id: true },
  });

  if (!target) return 0;

  const profile = await prisma.providerProfile.findUnique({
    where: { userId: target.id },
    select: { suspendedUntil: true },
  });

  if (!profile || profile.suspendedUntil !== null) return 0;

  await prisma.providerProfile.update({
    where: { userId: target.id },
    data: {
      suspendedUntil: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      suspendedAt: now,
      suspensionReason: 'auto_repeat_cancellation',
    },
  });

  return 1;
}

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Scores every technician who has anything to score, and manufactures the two
 * band-holders the search tests need.
 *
 * SILVER and GOLD both require **volume** as well as a score, and the seeded
 * booking set is far too small to reach 10 or 30 settled jobs honestly. Rather
 * than fabricate thirty bookings nobody will read, the two band-holders get
 * their `settled_jobs_count` set directly — which is exactly the number the band
 * function consumes, so the badge is still computed rather than asserted.
 */
async function seedSnapshots(
  prisma: PrismaClient,
  now: Date,
): Promise<{ snapshots: number; bands: Record<'SILVER' | 'GOLD', number> }> {
  const bands = { SILVER: 0, GOLD: 0 };

  // Handpicked so a local search shows a clear ordering.
  const silver = await prisma.user.findUnique({
    where: { phone: '+919000000001' },
    select: { id: true },
  });
  const gold = await prisma.user.findUnique({
    where: { phone: '+919000000007' },
    select: { id: true },
  });

  const boosted = new Map<string, number>();
  if (silver) boosted.set(silver.id, 14);
  if (gold) boosted.set(gold.id, 42);

  const providers = await prisma.providerProfile.findMany({ select: { userId: true } });
  let snapshots = 0;

  for (const provider of providers) {
    const existing = await prisma.trustScoreSnapshot.count({
      where: { providerId: provider.userId },
    });

    if (existing > 0) continue;

    const reviews = await prisma.review.findMany({
      where: {
        subjectUserId: provider.userId,
        direction: 'customer_to_provider',
        status: 'published',
      },
      select: { stars: true, tags: true, createdAt: true },
    });

    const stats = await prisma.providerStats.findUnique({
      where: { providerId: provider.userId },
      select: { acceptanceRate: true },
    });

    const settledBookings = await prisma.booking.count({
      where: {
        providerId: provider.userId,
        status: 'WORK_DONE',
        payments: { some: { status: { in: ['captured', 'partially_refunded', 'refunded'] } } },
      },
    });

    const cancellations = await prisma.booking.count({
      where: { providerId: provider.userId, status: 'CANCELLED_BY_PROVIDER' },
    });

    const complaints = await prisma.complaint.groupBy({
      by: ['severityOnResolution'],
      where: { againstUserId: provider.userId, status: 'resolved' },
      _count: { _all: true },
    });

    const severity = (name: 'minor' | 'major' | 'severe'): number =>
      complaints.find((row) => row.severityOnResolution === name)?._count._all ?? 0;

    const settledJobs = boosted.get(provider.userId) ?? settledBookings;

    const lastSettled =
      settledBookings > 0 ? new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) : null;

    const trust = computeTrustScore(
      {
        ratings: reviews.map((review) => ({ stars: review.stars, createdAt: review.createdAt })),
        acceptanceRate: stats?.acceptanceRate ?? null,
        settledJobs,
        providerCancellations: cancellations,
        complaints: {
          minor: severity('minor'),
          major: severity('major'),
          severe: severity('severe'),
        },
        lastSettledAt: lastSettled,
      },
      WEIGHTS,
      now,
    );

    const tagCounts: Record<string, number> = {};
    for (const review of reviews) {
      for (const tag of review.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }

    const avgStars =
      reviews.length === 0
        ? null
        : Math.round((reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length) * 10) / 10;

    const verification = await prisma.providerVerificationSummary.findUnique({
      where: { providerId: provider.userId },
      select: { badge: true },
    });

    const band = computeBadgeBand(
      verification?.badge ?? 'NONE',
      trust.score,
      settledJobs,
      THRESHOLDS,
    );

    await prisma.providerStats.upsert({
      where: { providerId: provider.userId },
      update: {
        avgStars,
        reviewCount: reviews.length,
        tagCounts,
        settledJobsCount: settledJobs,
        lastSettledAt: lastSettled,
        complaintsMinorCount: severity('minor'),
        complaintsMajorCount: severity('major'),
        complaintsSevereCount: severity('severe'),
        trustScore: trust.score,
        trustScoreUpdated: now,
      },
      create: {
        providerId: provider.userId,
        avgStars,
        reviewCount: reviews.length,
        tagCounts,
        settledJobsCount: settledJobs,
        lastSettledAt: lastSettled,
        complaintsMinorCount: severity('minor'),
        complaintsMajorCount: severity('major'),
        complaintsSevereCount: severity('severe'),
        trustScore: trust.score,
        trustScoreUpdated: now,
      },
    });

    if (verification) {
      await prisma.providerVerificationSummary.update({
        where: { providerId: provider.userId },
        data: { badge: band },
      });
    }

    if (trust.score !== null) {
      await prisma.trustScoreSnapshot.create({
        data: {
          id: deterministicUuid(`trust-snapshot:${provider.userId}`),
          providerId: provider.userId,
          score: trust.score,
          components: trust.components as never,
          badgeBandAfter: band,
          triggerTopic: 'seed',
          triggerAggregateId: null,
          createdAt: now,
        },
      });

      snapshots += 1;
    }

    if (band === 'SILVER') bands.SILVER += 1;
    if (band === 'GOLD') bands.GOLD += 1;
  }

  return { snapshots, bands };
}
