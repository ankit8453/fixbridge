/**
 * The trust score.
 *
 * ## The principle: it must be explainable
 *
 * A technician is going to ask ops "why is my score 62?" — in Hindi, on the
 * phone, probably annoyed. The only acceptable answer is a component-by-
 * component one: *your rating contributes 24 of a possible 35, your acceptance
 * rate 18 of 20, and one complaint cost you 10.* That requirement shapes
 * everything here:
 *
 *   - the function is **pure**, so the same inputs always give the same answer;
 *   - every component reports its raw value, its normalised value, its weight
 *     and its contribution, and all of that is stored on the snapshot;
 *   - nothing is multiplied by anything undocumented, and there is no term
 *     nobody can explain.
 *
 * A score somebody cannot argue with is a score they stop believing, and a
 * marketplace whose supply side does not believe its own ranking has a very
 * short life.
 *
 * ## Null, not zero
 *
 * A technician with no history scores `null`. Zero would mean "we measured them
 * and they are untrustworthy", which is a lie about somebody who simply started
 * on Tuesday, and it would bury every new technician under everyone with a
 * record. The ranking already treats a missing signal as neutral (0.5); that is
 * exactly the right answer here.
 */

import type { ConfigSource } from '../../core/scoped-config';

export const TRUST_COMPONENTS = [
  'rating',
  'acceptance',
  'reliability',
  'complaints',
  'recency',
] as const;

export type TrustComponentName = (typeof TRUST_COMPONENTS)[number];

export interface TrustWeights {
  rating: number;
  acceptance: number;
  reliability: number;
  complaints: number;
  recency: number;
  /** Days over which a review's influence halves. */
  ratingHalfLifeDays: number;
  /** Days over which "recently active" halves. */
  recencyHalfLifeDays: number;
  /**
   * Weighted complaint total at which the complaint component reaches zero.
   * With the severity weights below, one severe complaint alone gets there.
   */
  complaintZeroAt: number;
}

/**
 * What each severity costs.
 *
 * Deliberately steep at the top: one severe complaint — somebody was unsafe, or
 * money was taken — should wipe the component out on its own, while a handful of
 * minor ones should not. Averaging them would let a pattern of small failures
 * hide behind a large number of good jobs, and a single serious failure vanish
 * into it.
 */
export const COMPLAINT_SEVERITY_WEIGHT = { minor: 1, major: 3, severe: 6 } as const;

export type ComplaintSeverityName = keyof typeof COMPLAINT_SEVERITY_WEIGHT;

export interface DatedRating {
  stars: number;
  createdAt: Date;
}

export interface TrustInputs {
  /** Published customer→provider reviews only. Hidden ones are excluded upstream. */
  ratings: readonly DatedRating[];
  /** 0–1 from Phase 6, or null below its own small-sample floor. */
  acceptanceRate: number | null;
  /** Jobs that reached WORK_DONE and were paid for. */
  settledJobs: number;
  /** Jobs the technician abandoned after accepting. */
  providerCancellations: number;
  /** Complaints resolved against them, by severity. Dismissed ones are absent. */
  complaints: Record<ComplaintSeverityName, number>;
  /** When they last finished a paid job. Null if they never have. */
  lastSettledAt: Date | null;
}

export interface TrustComponent {
  name: TrustComponentName;
  /** What the underlying data actually said, for the explanation. */
  raw: number | null;
  /** 0–1. Null when there is no data for this component at all. */
  normalized: number | null;
  weight: number;
  /** `normalized × weight`, or 0 when the component is absent. */
  contribution: number;
  /** A short, honest reason, rendered through i18n for the technician. */
  reasonKey: string;
}

export interface TrustResult {
  /** 0–100, or null when there is nothing to score. */
  score: number | null;
  components: TrustComponent[];
  /** Sum of the weights that actually applied. */
  appliedWeight: number;
  /** How many published ratings fed the rating component. */
  ratingSampleSize: number;
}

/** Half-life decay: 1 today, 0.5 at the half-life, approaching 0 beyond. */
export function decayFactor(ageDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1;
  if (ageDays <= 0) return 1;

  return 0.5 ** (ageDays / halfLifeDays);
}

const daysBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);

/**
 * A recency-weighted mean of stars.
 *
 * Old glory fades. A technician who was excellent last year and mediocre this
 * month should read as mediocre, because that is what a customer booking them
 * today will get. A plain average would let a long good history absorb a recent
 * collapse for months.
 */
export function decayedAverageStars(
  ratings: readonly DatedRating[],
  now: Date,
  halfLifeDays: number,
): { average: number | null; weight: number } {
  let weighted = 0;
  let weight = 0;

  for (const rating of ratings) {
    const factor = decayFactor(daysBetween(rating.createdAt, now), halfLifeDays);

    weighted += rating.stars * factor;
    weight += factor;
  }

  // Every rating so old its weight rounds to nothing is the same as no ratings.
  if (weight < 1e-6) return { average: null, weight: 0 };

  return { average: weighted / weight, weight };
}

/* -------------------------------------------------------------------------- */
/* The score                                                                  */
/* -------------------------------------------------------------------------- */

const absent = (name: TrustComponentName, weight: number, reasonKey: string): TrustComponent => ({
  name,
  raw: null,
  normalized: null,
  weight,
  contribution: 0,
  reasonKey,
});

/**
 * Weighted sum of whatever components have data, rescaled to 0–100.
 *
 * Rescaling by the **applied** weight rather than the total is what lets a
 * technician with three jobs and no complaints score sensibly instead of being
 * punished for the components that cannot exist yet. It is the same reasoning as
 * the ranking scorer's neutral defaults, arrived at from the other direction.
 */
export function computeTrustScore(
  inputs: TrustInputs,
  weights: TrustWeights,
  now: Date = new Date(),
): TrustResult {
  const components: TrustComponent[] = [];

  /* ---- rating: (avg − 1) / 4, so one star is 0 and five is 1 ---- */
  const decayed = decayedAverageStars(inputs.ratings, now, weights.ratingHalfLifeDays);

  if (decayed.average === null) {
    components.push(absent('rating', weights.rating, 'trust.reason.noRatings'));
  } else {
    const normalized = clamp01((decayed.average - 1) / 4);

    components.push({
      name: 'rating',
      raw: round1(decayed.average),
      normalized,
      weight: weights.rating,
      contribution: normalized * weights.rating,
      reasonKey: 'trust.reason.rating',
    });
  }

  /* ---- acceptance: already 0–1, straight from Phase 6 ---- */
  if (inputs.acceptanceRate === null) {
    components.push(absent('acceptance', weights.acceptance, 'trust.reason.noAcceptance'));
  } else {
    const normalized = clamp01(inputs.acceptanceRate);

    components.push({
      name: 'acceptance',
      raw: normalized,
      normalized,
      weight: weights.acceptance,
      contribution: normalized * weights.acceptance,
      reasonKey: 'trust.reason.acceptance',
    });
  }

  /**
   * Reliability: of the jobs they took on, how many did they see through.
   *
   * Only accepted work counts on either side. A rejected request never became a
   * commitment, so it belongs to the acceptance component and would be
   * double-counted here.
   */
  const finished = inputs.settledJobs;
  const abandoned = inputs.providerCancellations;
  const committed = finished + abandoned;

  if (committed === 0) {
    components.push(absent('reliability', weights.reliability, 'trust.reason.noJobs'));
  } else {
    const normalized = clamp01(finished / committed);

    components.push({
      name: 'reliability',
      raw: normalized,
      normalized,
      weight: weights.reliability,
      contribution: normalized * weights.reliability,
      reasonKey: 'trust.reason.reliability',
    });
  }

  /**
   * Complaints: full marks until something is upheld against them.
   *
   * Present even with zero complaints, unlike the others — "nothing has been
   * upheld against this person" is real information, not missing data, and a
   * clean record should count for something.
   */
  const complaintLoad =
    inputs.complaints.minor * COMPLAINT_SEVERITY_WEIGHT.minor +
    inputs.complaints.major * COMPLAINT_SEVERITY_WEIGHT.major +
    inputs.complaints.severe * COMPLAINT_SEVERITY_WEIGHT.severe;

  const complaintNormalized = clamp01(1 - complaintLoad / Math.max(1, weights.complaintZeroAt));

  components.push({
    name: 'complaints',
    raw: complaintLoad,
    normalized: complaintNormalized,
    weight: weights.complaints,
    contribution: complaintNormalized * weights.complaints,
    reasonKey: complaintLoad === 0 ? 'trust.reason.noComplaints' : 'trust.reason.complaints',
  });

  /* ---- recency: how long since they last finished a paid job ---- */
  if (inputs.lastSettledAt === null) {
    components.push(absent('recency', weights.recency, 'trust.reason.noActivity'));
  } else {
    const ageDays = Math.max(0, daysBetween(inputs.lastSettledAt, now));
    const normalized = clamp01(decayFactor(ageDays, weights.recencyHalfLifeDays));

    components.push({
      name: 'recency',
      raw: round1(ageDays),
      normalized,
      weight: weights.recency,
      contribution: normalized * weights.recency,
      reasonKey: 'trust.reason.recency',
    });
  }

  /**
   * No history, no score.
   *
   * The complaints component is always present, so it alone must not be enough
   * to produce a number — otherwise every technician who has never worked would
   * score full marks for having never been complained about.
   */
  const hasHistory = inputs.ratings.length > 0 || committed > 0 || inputs.acceptanceRate !== null;

  if (!hasHistory) {
    return {
      score: null,
      components,
      appliedWeight: 0,
      ratingSampleSize: 0,
    };
  }

  const applied = components.filter((component) => component.normalized !== null);
  const appliedWeight = applied.reduce((sum, component) => sum + component.weight, 0);

  if (appliedWeight <= 0) {
    return { score: null, components, appliedWeight: 0, ratingSampleSize: inputs.ratings.length };
  }

  const earned = applied.reduce((sum, component) => sum + component.contribution, 0);

  return {
    score: Math.round((earned / appliedWeight) * 100),
    components,
    appliedWeight,
    ratingSampleSize: inputs.ratings.length,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/* Badge bands                                                                */
/* -------------------------------------------------------------------------- */

import { type Badge } from '../verification/badge';

export interface BadgeBandThresholds {
  silverScore: number;
  silverJobs: number;
  goldScore: number;
  goldJobs: number;
}

/**
 * Which band a verified technician sits in.
 *
 * **Bands ride on verification and never replace it.** A technician who has not
 * completed the KYC ladder is `NONE` however good their score is, because the
 * badge answers "do we know who this is" before it answers "how do they behave".
 * And both a score *and* a volume threshold are required, so nobody reaches GOLD
 * on two perfect jobs.
 */
export function computeBadgeBand(
  verifiedBadge: Badge,
  trustScore: number | null,
  settledJobs: number,
  thresholds: BadgeBandThresholds,
): Badge {
  if (verifiedBadge === 'NONE') return 'NONE';
  if (trustScore === null) return 'VERIFIED';

  if (trustScore >= thresholds.goldScore && settledJobs >= thresholds.goldJobs) return 'GOLD';
  if (trustScore >= thresholds.silverScore && settledJobs >= thresholds.silverJobs) return 'SILVER';

  return 'VERIFIED';
}

/* -------------------------------------------------------------------------- */
/* Suspension rules                                                           */
/* -------------------------------------------------------------------------- */

export type SuspensionReasonName =
  | 'auto_low_trust'
  | 'auto_repeat_cancellation'
  | 'complaint_severe'
  | 'safety_pending_review'
  | 'ops_manual';

export interface SuspensionRules {
  /** Below this, with enough jobs to mean it. */
  lowTrustScore: number;
  lowTrustMinJobs: number;
  /** This many provider cancellations inside the window. */
  cancellationCount: number;
  cancellationWindowDays: number;
  /** How long an automatic suspension lasts. */
  durationDays: number;
}

export interface SuspensionInputs {
  trustScore: number | null;
  settledJobs: number;
  /** Provider-side cancellations inside `cancellationWindowDays`. */
  recentCancellations: number;
  /** Any complaint resolved `severe` and still counted. */
  severeComplaints: number;
}

export interface SuspensionDecision {
  suspend: boolean;
  reason: SuspensionReasonName | null;
  /** i18n key explaining it to the technician. */
  reasonKey: string | null;
}

/**
 * Whether the engine should suspend somebody, and why.
 *
 * Pure, and separate from the score, because these are **rules** rather than a
 * judgement: a technician is entitled to know the exact line they crossed. The
 * order matters — the most serious cause is reported, so a technician with a
 * severe complaint *and* a low score is told about the complaint.
 *
 * Note what is absent: nothing here can fire on a technician with no history.
 * Every rule requires either enough jobs or an upheld complaint.
 */
export function evaluateSuspension(
  inputs: SuspensionInputs,
  rules: SuspensionRules,
): SuspensionDecision {
  if (inputs.severeComplaints > 0) {
    return {
      suspend: true,
      reason: 'complaint_severe',
      reasonKey: 'trust.suspension.severeComplaint',
    };
  }

  if (inputs.recentCancellations >= rules.cancellationCount) {
    return {
      suspend: true,
      reason: 'auto_repeat_cancellation',
      reasonKey: 'trust.suspension.repeatCancellation',
    };
  }

  if (
    inputs.trustScore !== null &&
    inputs.trustScore < rules.lowTrustScore &&
    inputs.settledJobs >= rules.lowTrustMinJobs
  ) {
    return { suspend: true, reason: 'auto_low_trust', reasonKey: 'trust.suspension.lowTrust' };
  }

  return { suspend: false, reason: null, reasonKey: null };
}

/** Kept so the module's public surface stays self-describing. */
export type { ConfigSource };
