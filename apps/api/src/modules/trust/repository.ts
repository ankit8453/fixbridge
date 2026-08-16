// All Prisma for the trust engine. Reads current truth; never event payloads.
import type { Badge, Prisma, PrismaClient, SuspensionReason } from '@prisma/client';
import type { ComplaintSeverityName, DatedRating } from './score';

/**
 * Everything the score needs, read fresh from the tables.
 *
 * The engine is a **recompute-from-source-of-truth** consumer, not an
 * incremental one. That is what makes it idempotent for free: replaying
 * `review.created` five times recounts the same five reviews and produces the
 * same number, whereas an incremental counter would count them five times over.
 * At-least-once delivery guarantees that replay happens eventually, so "for
 * free" is the difference between correct and quietly wrong.
 */
export interface TrustSourceData {
  ratings: DatedRating[];
  acceptanceRate: number | null;
  settledJobs: number;
  lastSettledAt: Date | null;
  providerCancellations: number;
  recentCancellations: number;
  complaints: Record<ComplaintSeverityName, number>;
  verifiedBadge: Badge;
  reviewCount: number;
  avgStars: number | null;
  tagCounts: Record<string, number>;
}

export async function loadTrustSource(
  prisma: PrismaClient,
  providerId: string,
  cancellationWindowDays: number,
  now: Date,
): Promise<TrustSourceData | null> {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: providerId },
    select: { userId: true, verification: { select: { badge: true } } },
  });

  if (!profile) return null;

  const windowStart = new Date(now.getTime() - cancellationWindowDays * 24 * 60 * 60 * 1000);

  const [reviews, stats, settled, cancellations, recentCancellations, complaints] =
    await Promise.all([
      // Published customer→provider only. A hidden review is excluded from every
      // aggregate the moment it is hidden, because the next recompute simply
      // does not see it.
      prisma.review.findMany({
        where: {
          subjectUserId: providerId,
          direction: 'customer_to_provider',
          status: 'published',
        },
        select: { stars: true, tags: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.providerStats.findUnique({
        where: { providerId },
        select: { acceptanceRate: true },
      }),

      // A job is "settled" when it is done **and** paid for. Either rail counts:
      // cash that reached the technician is money the customer parted with.
      prisma.booking.findMany({
        where: {
          providerId,
          status: 'WORK_DONE',
          payments: { some: { status: { in: ['captured', 'partially_refunded', 'refunded'] } } },
        },
        select: { id: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),

      prisma.booking.count({ where: { providerId, status: 'CANCELLED_BY_PROVIDER' } }),

      prisma.booking.count({
        where: {
          providerId,
          status: 'CANCELLED_BY_PROVIDER',
          updatedAt: { gte: windowStart },
        },
      }),

      prisma.complaint.groupBy({
        by: ['severityOnResolution'],
        where: { againstUserId: providerId, status: 'resolved' },
        _count: { _all: true },
      }),
    ]);

  const severityCount = (severity: ComplaintSeverityName): number =>
    complaints.find((row) => row.severityOnResolution === severity)?._count._all ?? 0;

  const tagCounts: Record<string, number> = {};
  for (const review of reviews) {
    for (const tag of review.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }

  const plainAverage =
    reviews.length === 0
      ? null
      : Math.round((reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length) * 10) / 10;

  return {
    ratings: reviews.map((review) => ({ stars: review.stars, createdAt: review.createdAt })),
    acceptanceRate: stats?.acceptanceRate ?? null,
    settledJobs: settled.length,
    lastSettledAt: settled[0]?.updatedAt ?? null,
    providerCancellations: cancellations,
    recentCancellations,
    complaints: {
      minor: severityCount('minor'),
      major: severityCount('major'),
      severe: severityCount('severe'),
    },
    verifiedBadge: profile.verification?.badge ?? 'NONE',
    reviewCount: reviews.length,
    // The **plain** mean is what a customer is shown — "4.6 stars from 12
    // reviews" has to be checkable by adding them up. The decayed one is the
    // scorer's business and stays inside the score.
    avgStars: plainAverage,
    tagCounts,
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface SnapshotInput {
  providerId: string;
  score: number;
  components: Prisma.InputJsonValue;
  badgeBandAfter: Badge;
  triggerTopic: string;
  triggerAggregateId: string | null;
}

export async function writeSnapshot(
  tx: Prisma.TransactionClient,
  input: SnapshotInput,
): Promise<string> {
  const snapshot = await tx.trustScoreSnapshot.create({
    data: {
      providerId: input.providerId,
      score: input.score,
      components: input.components,
      badgeBandAfter: input.badgeBandAfter,
      triggerTopic: input.triggerTopic,
      triggerAggregateId: input.triggerAggregateId,
    },
    select: { id: true },
  });

  return snapshot.id;
}

/**
 * The score on the most recent snapshot, or null if there is none.
 *
 * Used only by the scheduled sweep, to decide whether anything is worth
 * recording. Reading the last snapshot rather than `provider_stats.trust_score`
 * on purpose: stats are a projection that a partial failure could leave stale,
 * and the snapshot chain is the thing the trend chart is drawn from.
 */
export async function lastSnapshotScore(
  prisma: PrismaClient,
  providerId: string,
): Promise<number | null> {
  const last = await prisma.trustScoreSnapshot.findFirst({
    where: { providerId },
    orderBy: { createdAt: 'desc' },
    select: { score: true },
  });

  return last?.score ?? null;
}

export interface StatsUpdate {
  avgStars: number | null;
  reviewCount: number;
  tagCounts: Prisma.InputJsonValue;
  settledJobsCount: number;
  lastSettledAt: Date | null;
  complaintsMinorCount: number;
  complaintsMajorCount: number;
  complaintsSevereCount: number;
  trustScore: number | null;
  trustScoreUpdated: Date;
}

/** Upserts, because a technician's first review may precede their first booking. */
export async function saveStats(
  tx: Prisma.TransactionClient,
  providerId: string,
  update: StatsUpdate,
): Promise<void> {
  await tx.providerStats.upsert({
    where: { providerId },
    update,
    create: { providerId, ...update },
  });
}

export async function saveBadgeBand(
  tx: Prisma.TransactionClient,
  providerId: string,
  badge: Badge,
): Promise<void> {
  // Only touches the band. `levelsPassed` and `badgeSince` belong to Phase 4's
  // ladder and are never rewritten from here.
  await tx.providerVerificationSummary.updateMany({
    where: { providerId },
    data: { badge },
  });
}

export async function applySuspension(
  tx: Prisma.TransactionClient,
  providerId: string,
  until: Date,
  reason: SuspensionReason,
  at: Date,
): Promise<void> {
  await tx.providerProfile.update({
    where: { userId: providerId },
    data: { suspendedUntil: until, suspendedAt: at, suspensionReason: reason },
  });
}

export async function liftSuspension(prisma: PrismaClient, providerId: string): Promise<void> {
  await prisma.providerProfile.update({
    where: { userId: providerId },
    data: { suspendedUntil: null, suspendedAt: null, suspensionReason: null },
  });
}

export function listSnapshots(prisma: PrismaClient, providerId: string, limit: number) {
  return prisma.trustScoreSnapshot.findMany({
    where: { providerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** Every listed technician. Drives the seed and any bulk recompute. */
export function listScorableProviders(prisma: PrismaClient): Promise<{ userId: string }[]> {
  return prisma.providerProfile.findMany({ select: { userId: true } });
}
