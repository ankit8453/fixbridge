import type { Prisma, SuspensionReason } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import type { JobDefinition } from '../../core/jobs';
import { enqueueOutbox, type DeliveredEvent, type OutboxRegistry } from '../../core/outbox';
import { BOOKING_TOPICS } from '../bookings/state-machine';
import { BADGE_CHANGED_TOPIC } from '../notifications/routing';
import { PAYMENT_TOPICS } from '../payments/state-machine';
import type { Badge } from '../verification/badge';
import * as repo from './repository';
import {
  computeBadgeBand,
  computeTrustScore,
  evaluateSuspension,
  type BadgeBandThresholds,
  type SuspensionRules,
  type TrustResult,
  type TrustWeights,
} from './score';
import { TRUST_TOPICS } from './topics';

/**
 * The trust engine.
 *
 * One consumer, subscribed to everything that could change how a technician
 * looks, doing the same thing every time: **read the current truth from the
 * tables, score it, write a snapshot.** Never "add one to a counter", never
 * "adjust by the delta in this event".
 *
 * That choice buys idempotency outright. Our outbox is at-least-once, so every
 * handler will be called twice eventually; a recompute called twice produces the
 * same number twice, while an increment called twice is simply wrong and nobody
 * finds out for months.
 */

export interface TrustDeps {
  context: AppContext;
  now?: () => Date;
}

export interface RecomputeOptions {
  /**
   * Write a snapshot only when the score actually moved.
   *
   * Off for event-driven recomputes: "this review changed nothing" is itself
   * worth recording, and the trigger topic on the row is what lets a technician
   * trace a jump back to a cause.
   *
   * On for the scheduled sweep, which touches every technician every few hours.
   * Without it, a provider with 200 identical daily snapshots would have a trend
   * chart made entirely of noise, and the one row where something actually
   * happened would be impossible to find.
   */
  snapshotOnlyOnChange?: boolean;
}

const nowOf = (deps: TrustDeps): Date => (deps.now ? deps.now() : new Date());

export function trustWeightsFrom(context: AppContext): TrustWeights {
  return {
    rating: context.config.TRUST_WEIGHT_RATING,
    acceptance: context.config.TRUST_WEIGHT_ACCEPTANCE,
    reliability: context.config.TRUST_WEIGHT_RELIABILITY,
    complaints: context.config.TRUST_WEIGHT_COMPLAINTS,
    recency: context.config.TRUST_WEIGHT_RECENCY,
    ratingHalfLifeDays: context.config.TRUST_RATING_HALF_LIFE_DAYS,
    recencyHalfLifeDays: context.config.TRUST_RECENCY_HALF_LIFE_DAYS,
    complaintZeroAt: context.config.TRUST_COMPLAINT_ZERO_AT,
  };
}

export function badgeThresholdsFrom(context: AppContext): BadgeBandThresholds {
  return {
    silverScore: context.config.BADGE_SILVER_MIN_SCORE,
    silverJobs: context.config.BADGE_SILVER_MIN_JOBS,
    goldScore: context.config.BADGE_GOLD_MIN_SCORE,
    goldJobs: context.config.BADGE_GOLD_MIN_JOBS,
  };
}

/** Ladder order, so "promoted" means something rather than merely "different". */
const BADGE_RANK: Record<Badge, number> = { NONE: 0, VERIFIED: 1, SILVER: 2, GOLD: 3 };

const rankOf = (badge: Badge): number => BADGE_RANK[badge] ?? 0;

export function suspensionRulesFrom(context: AppContext): SuspensionRules {
  return {
    lowTrustScore: context.config.SUSPEND_TRUST_BELOW,
    lowTrustMinJobs: context.config.SUSPEND_TRUST_MIN_JOBS,
    cancellationCount: context.config.SUSPEND_CANCELLATION_COUNT,
    cancellationWindowDays: context.config.SUSPEND_CANCELLATION_WINDOW_DAYS,
    durationDays: context.config.SUSPEND_DURATION_DAYS,
  };
}

/* -------------------------------------------------------------------------- */
/* Recompute                                                                  */
/* -------------------------------------------------------------------------- */

export interface RecomputeResult {
  providerId: string;
  score: number | null;
  badge: Badge;
  suspended: boolean;
  suspensionReason: SuspensionReason | null;
  snapshotId: string | null;
  trust: TrustResult;
}

/**
 * Rescores one technician and applies every consequence.
 *
 * Score → badge band → suspension, in that order, because each depends on the
 * one before it. All of it in a single transaction, so a technician can never be
 * left with a new score and an old badge.
 */
export async function recomputeProviderTrust(
  deps: TrustDeps,
  providerId: string,
  trigger: { topic: string; aggregateId: string | null },
  options: RecomputeOptions = {},
): Promise<RecomputeResult | null> {
  const { context } = deps;
  const at = nowOf(deps);
  const rules = suspensionRulesFrom(context);

  const source = await repo.loadTrustSource(
    context.prisma,
    providerId,
    rules.cancellationWindowDays,
    at,
  );

  if (!source) return null;

  const trust = computeTrustScore(
    {
      ratings: source.ratings,
      acceptanceRate: source.acceptanceRate,
      settledJobs: source.settledJobs,
      providerCancellations: source.providerCancellations,
      complaints: source.complaints,
      lastSettledAt: source.lastSettledAt,
    },
    trustWeightsFrom(context),
    at,
  );

  const badge = computeBadgeBand(
    source.verifiedBadge,
    trust.score,
    source.settledJobs,
    badgeThresholdsFrom(context),
  );

  const decision = evaluateSuspension(
    {
      trustScore: trust.score,
      settledJobs: source.settledJobs,
      recentCancellations: source.recentCancellations,
      severeComplaints: source.complaints.severe,
    },
    rules,
  );

  let snapshotId: string | null = null;

  /**
   * What the badge was before this run, read from the same row the band is
   * written to. Only a *promotion* is announced: reaching SILVER should feel
   * like something, and being told you have slipped back is a message that costs
   * more goodwill than it buys.
   */
  const previousBadge = source.verifiedBadge;
  const promoted =
    badge !== previousBadge &&
    (badge === 'SILVER' || badge === 'GOLD') &&
    rankOf(badge) > rankOf(previousBadge);

  const lastScore = options.snapshotOnlyOnChange
    ? await repo.lastSnapshotScore(context.prisma, providerId)
    : null;

  await context.prisma.$transaction(async (tx) => {
    await repo.saveStats(tx, providerId, {
      avgStars: source.avgStars,
      reviewCount: source.reviewCount,
      tagCounts: source.tagCounts as Prisma.InputJsonValue,
      settledJobsCount: source.settledJobs,
      lastSettledAt: source.lastSettledAt,
      complaintsMinorCount: source.complaints.minor,
      complaintsMajorCount: source.complaints.major,
      complaintsSevereCount: source.complaints.severe,
      trustScore: trust.score,
      trustScoreUpdated: at,
    });

    await repo.saveBadgeBand(tx, providerId, badge);

    // A snapshot only exists once there is something to explain. Writing rows of
    // "null, because they have never worked" would bury the real history.
    const unchanged = options.snapshotOnlyOnChange && lastScore === trust.score;

    if (trust.score !== null && !unchanged) {
      snapshotId = await repo.writeSnapshot(tx, {
        providerId,
        score: trust.score,
        components: trust.components as unknown as Prisma.InputJsonValue,
        badgeBandAfter: badge,
        triggerTopic: trigger.topic,
        triggerAggregateId: trigger.aggregateId,
      });
    }

    if (promoted) {
      await enqueueOutbox(tx, {
        topic: BADGE_CHANGED_TOPIC,
        aggregateType: 'provider',
        aggregateId: providerId,
        payload: { badge, previousBadge, trustScore: trust.score },
      });
    }

    if (decision.suspend && decision.reason) {
      const until = new Date(at.getTime() + rules.durationDays * 24 * 60 * 60 * 1000);

      await repo.applySuspension(tx, providerId, until, decision.reason, at);

      await enqueueOutbox(tx, {
        topic: TRUST_TOPICS.providerSuspended,
        aggregateType: 'provider',
        aggregateId: providerId,
        payload: {
          reason: decision.reason,
          reasonKey: decision.reasonKey,
          until: until.toISOString(),
          trustScore: trust.score,
        },
      });
    }
  });

  context.logger.info(
    {
      providerId,
      score: trust.score,
      badge,
      suspended: decision.suspend,
      trigger: trigger.topic,
    },
    'trust recomputed',
  );

  return {
    providerId,
    score: trust.score,
    badge,
    suspended: decision.suspend,
    suspensionReason: decision.reason,
    snapshotId,
    trust,
  };
}

/* -------------------------------------------------------------------------- */
/* Suspension, directly                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Suspends immediately, without waiting for a recompute.
 *
 * Used by the safety path. Every other signal in this system is eventually
 * consistent through the outbox, which is exactly right for money and exactly
 * wrong for somebody being unsafe in a stranger's home — that decision happens
 * inside the request that reports it, before the response is written.
 */
export async function suspendNow(
  deps: TrustDeps,
  providerId: string,
  reason: SuspensionReason,
  reasonKey: string,
  durationDays?: number,
): Promise<Date> {
  const { context } = deps;
  const at = nowOf(deps);
  const days = durationDays ?? suspensionRulesFrom(context).durationDays;
  const until = new Date(at.getTime() + days * 24 * 60 * 60 * 1000);

  await context.prisma.$transaction(async (tx) => {
    await repo.applySuspension(tx, providerId, until, reason, at);

    await enqueueOutbox(tx, {
      topic: TRUST_TOPICS.providerSuspended,
      aggregateType: 'provider',
      aggregateId: providerId,
      payload: { reason, reasonKey, until: until.toISOString(), immediate: true },
    });
  });

  context.logger.warn({ providerId, reason, until }, 'provider suspended immediately');

  return until;
}

/** Ops lifting a suspension early. Phase 11 puts a screen on this. */
export async function liftSuspension(deps: TrustDeps, providerId: string): Promise<void> {
  const { context } = deps;

  const profile = await context.prisma.providerProfile.findUnique({
    where: { userId: providerId },
    select: { suspendedUntil: true },
  });

  if (!profile) {
    throw new AppError(404, 'PROVIDER_NOT_FOUND', `No technician ${providerId}`, {
      messageKey: 'errors.providers.profileNotFound',
    });
  }

  if (profile.suspendedUntil === null) {
    throw new AppError(409, 'NOT_SUSPENDED', 'That technician is not suspended', {
      messageKey: 'errors.trust.notSuspended',
    });
  }

  await repo.liftSuspension(context.prisma, providerId);

  await context.prisma.$transaction(async (tx) => {
    await enqueueOutbox(tx, {
      topic: TRUST_TOPICS.providerReinstated,
      aggregateType: 'provider',
      aggregateId: providerId,
      payload: { liftedAt: nowOf(deps).toISOString() },
    });
  });

  context.logger.info({ providerId }, 'suspension lifted');
}

/* -------------------------------------------------------------------------- */
/* The consumer                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything that could change how a technician looks.
 *
 * Booking outcomes move acceptance and reliability, payments move settled jobs
 * and recency, reviews move the rating, and a resolved complaint moves the
 * complaint record. Anything else — a slot being blocked, a quotation being
 * revised — cannot change the score, so subscribing to it would only mean
 * recomputing for nothing.
 */
export const TRUST_TRIGGER_TOPICS: readonly string[] = [
  BOOKING_TOPICS.accepted,
  BOOKING_TOPICS.rejected,
  BOOKING_TOPICS.expired,
  BOOKING_TOPICS.cancelled_by_provider,
  PAYMENT_TOPICS.captured,
  PAYMENT_TOPICS.cashRecorded,
  TRUST_TOPICS.reviewCreated,
  TRUST_TOPICS.reviewHidden,
  TRUST_TOPICS.complaintResolved,
];

/**
 * Resolves which technician an event is about.
 *
 * Most topics carry a booking id; the complaint and review ones carry the
 * provider directly in the payload where they can. A topic we cannot map is
 * skipped rather than guessed at.
 */
async function providerFor(context: AppContext, event: DeliveredEvent): Promise<string | null> {
  if (event.aggregateType === 'provider') return event.aggregateId;

  const payload = event.payload as { providerId?: string } | null;
  if (payload?.providerId) return payload.providerId;

  const booking = await context.prisma.booking.findUnique({
    where: { id: event.aggregateId },
    select: { providerId: true },
  });

  return booking?.providerId ?? null;
}

/* -------------------------------------------------------------------------- */
/* The scheduled sweep                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Rescores everybody, whether or not anything happened to them.
 *
 * The event-driven engine has one blind spot, and it is structural: **nothing
 * happening is also a signal.** A technician who stops accepting work generates
 * no events, so their score — including the recency component whose whole job is
 * to decay — freezes at whatever it was the day they went quiet. A customer
 * three months later sees a score that describes somebody who is no longer
 * working.
 *
 * Snapshots are written only when the number actually moves, so a technician
 * with a steady record accumulates nothing rather than four identical rows a day.
 */
export async function recomputeAllProviders(deps: TrustDeps): Promise<{
  scanned: number;
  changed: number;
}> {
  const { context } = deps;

  const providers = await context.prisma.providerProfile.findMany({
    // Everyone with a profile, including the suspended: a suspension lapses on
    // its own, and their score should be current when it does.
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });

  let changed = 0;

  for (const provider of providers) {
    const before = await repo.lastSnapshotScore(context.prisma, provider.userId);

    const result = await recomputeProviderTrust(
      deps,
      provider.userId,
      { topic: 'trust.scheduled_recompute', aggregateId: null },
      { snapshotOnlyOnChange: true },
    );

    if (result && result.score !== before) changed += 1;
  }

  context.logger.info(
    { scanned: providers.length, changed },
    'trust: scheduled recompute finished',
  );

  return { scanned: providers.length, changed };
}

/**
 * "Nightly" in the docs, an interval in the code — same reasoning as the slot
 * horizon: a process that restarts twice a day would never reach a 24-hour
 * timer. Running it four times a day costs a query that mostly finds nothing,
 * which is far cheaper than a decay that quietly stopped applying.
 */
export function createTrustJobs(context: AppContext): JobDefinition[] {
  return [
    {
      name: 'trust-recompute',
      intervalMs: context.config.TRUST_RECOMPUTE_JOB_INTERVAL_MS,
      lockTtlMs: 10 * 60_000,
      async run() {
        await recomputeAllProviders({ context });
      },
    },
  ];
}

export function registerTrustEngine(registry: OutboxRegistry, context: AppContext): void {
  const handler = async (event: DeliveredEvent): Promise<void> => {
    const providerId = await providerFor(context, event);

    if (!providerId) {
      context.logger.debug(
        { topic: event.topic, aggregateId: event.aggregateId },
        'trust: no technician for this event; skipping',
      );
      return;
    }

    await recomputeProviderTrust({ context }, providerId, {
      topic: event.topic,
      aggregateId: event.aggregateId,
    });
  };

  for (const topic of TRUST_TRIGGER_TOPICS) {
    registry.subscribe(topic, handler);
  }
}
