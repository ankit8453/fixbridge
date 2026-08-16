import { Router, type Request, type RequestHandler } from 'express';
import { AUDIT_ACTIONS, auditActor, type AuditEntry } from '../../core/audit';
import { getContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import type { Badge } from '../verification/badge';
import * as repo from './repository';
import { computeTrustScore, type TrustComponent } from './score';
import {
  badgeThresholdsFrom,
  liftSuspension,
  recomputeProviderTrust,
  suspendNow,
  suspensionRulesFrom,
  trustWeightsFrom,
  type TrustDeps,
} from './service';
import { z } from 'zod';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** Ops mutations all carry an audit entry, so there is no un-audited variant. */
const opsDeps = (req: Request, entry: AuditEntry): TrustDeps => ({
  context: getContext(req),
  audit: { actor: auditActor(req), entry },
});

/* -------------------------------------------------------------------------- */
/* /api/v1/providers/me/trust                                                 */
/* -------------------------------------------------------------------------- */

export const router = Router();

router.use(authenticate, requireRoles('technician'));

/**
 * "Why is my score 62?"
 *
 * The whole reason the components are stored rather than just the number. A
 * technician gets every input, what it was worth, and what it contributed —
 * with i18n keys so the partner app can say it in Hindi. Ops will be asked this
 * question on the phone, and "the algorithm decided" is not an answer anybody
 * accepts about their own livelihood.
 *
 * Computed live rather than read off the last snapshot, so the answer is about
 * their position **now**; the snapshots below are the trend behind it.
 */
router.get(
  '/',
  handle(async (req, res) => {
    const context = getContext(req);
    const providerId = getAuthUser(req).id;
    const rules = suspensionRulesFrom(context);

    const source = await repo.loadTrustSource(
      context.prisma,
      providerId,
      rules.cancellationWindowDays,
      new Date(),
    );

    if (!source) {
      throw new AppError(404, 'PROVIDER_NOT_FOUND', 'You do not have a technician profile yet', {
        messageKey: 'errors.providers.profileNotFound',
      });
    }

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
      new Date(),
    );

    const [profile, snapshots] = await Promise.all([
      context.prisma.providerProfile.findUnique({
        where: { userId: providerId },
        select: {
          suspendedUntil: true,
          suspensionReason: true,
          verification: { select: { badge: true } },
        },
      }),
      repo.listSnapshots(context.prisma, providerId, 10),
    ]);

    const thresholds = badgeThresholdsFrom(context);

    res.status(200).json({
      trust: {
        score: trust.score,
        badge: (profile?.verification?.badge ?? 'NONE') as Badge,
        settledJobs: source.settledJobs,
        // Every component, including the ones with no data yet — a technician
        // should be able to see what they have not been measured on.
        components: trust.components.map((component) => renderComponent(component, req)),
        /** What the next band needs. Concrete, not "keep up the good work". */
        nextBand: nextBandAdvice(trust.score, source.settledJobs, thresholds),
        suspendedUntil: profile?.suspendedUntil?.toISOString() ?? null,
        suspensionReason: profile?.suspensionReason ?? null,
        trend: snapshots.map((snapshot) => ({
          score: snapshot.score,
          badge: snapshot.badgeBandAfter,
          trigger: snapshot.triggerTopic,
          at: snapshot.createdAt.toISOString(),
        })),
      },
    });
  }),
);

function renderComponent(component: TrustComponent, req: Request) {
  return {
    name: component.name,
    label: req.t(`trust.component.${component.name}`),
    reason: req.t(component.reasonKey),
    raw: component.raw,
    normalized: component.normalized,
    weight: component.weight,
    contribution: Math.round(component.contribution * 10) / 10,
    /** True when there is no data for it yet, so the app can grey it out. */
    pending: component.normalized === null,
  };
}

/**
 * The gap to the next band, in the two dimensions that matter.
 *
 * Both a score and a volume threshold, because a technician who is told "you
 * need 70" and reaches 72 with four jobs — and still sees no badge — has been
 * misled by their own app.
 */
function nextBandAdvice(
  score: number | null,
  settledJobs: number,
  thresholds: ReturnType<typeof badgeThresholdsFrom>,
) {
  if (score === null)
    return {
      band: 'SILVER' as const,
      needsScore: thresholds.silverScore,
      needsJobs: thresholds.silverJobs,
    };

  if (score >= thresholds.goldScore && settledJobs >= thresholds.goldJobs) return null;

  const target =
    score >= thresholds.silverScore && settledJobs >= thresholds.silverJobs
      ? { band: 'GOLD' as const, score: thresholds.goldScore, jobs: thresholds.goldJobs }
      : { band: 'SILVER' as const, score: thresholds.silverScore, jobs: thresholds.silverJobs };

  return {
    band: target.band,
    needsScore: Math.max(0, target.score - score),
    needsJobs: Math.max(0, target.jobs - settledJobs),
  };
}

/* -------------------------------------------------------------------------- */
/* Ops — suspension                                                           */
/* -------------------------------------------------------------------------- */

const suspendSchema = z
  .object({
    providerId: z.string().uuid(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

const providerIdSchema = z.object({ providerId: z.string().uuid() });

/**
 * Lifting a suspension needs a reason too.
 *
 * Symmetry with suspending, and for the same reason: "ops let them back on"
 * with no note is not an answer anybody can give six months later when the same
 * technician is in trouble again.
 */
const reinstateSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export const opsRouter = Router();

opsRouter.use(authenticate, requireRoles('ops', 'admin'));

/** Ops suspending directly. Phase 11 puts a screen on it. */
opsRouter.post(
  '/suspend',
  handle(async (req, res) => {
    const input = suspendSchema.parse(req.body);

    const until = await suspendNow(
      opsDeps(req, {
        action: AUDIT_ACTIONS.providerSuspend,
        targetType: 'provider',
        targetId: input.providerId,
        // The reason is mandatory in the schema and it is the whole substance:
        // a suspension nobody wrote a reason for is one nobody can defend.
        payload: { reason: input.reason, days: input.days ?? null },
      }),
      input.providerId,
      'ops_manual',
      'trust.suspension.opsManual',
      input.days,
    );

    res.status(200).json({ providerId: input.providerId, suspendedUntil: until.toISOString() });
  }),
);

opsRouter.post(
  '/:providerId/reinstate',
  handle(async (req, res) => {
    const { providerId } = providerIdSchema.parse(req.params);
    const input = reinstateSchema.parse(req.body ?? {});

    await liftSuspension(
      opsDeps(req, {
        action: AUDIT_ACTIONS.providerReinstate,
        targetType: 'provider',
        targetId: providerId,
        payload: { reason: input.reason },
      }),
      providerId,
    );

    res.status(200).json({ providerId, suspendedUntil: null });
  }),
);

/** Forces a recompute. Useful after a config change, and to ops when debugging. */
opsRouter.post(
  '/:providerId/recompute',
  handle(async (req, res) => {
    const { providerId } = providerIdSchema.parse(req.params);

    const result = await recomputeProviderTrust(
      opsDeps(req, {
        action: AUDIT_ACTIONS.providerRecompute,
        targetType: 'provider',
        targetId: providerId,
        payload: {},
      }),
      providerId,
      { topic: 'ops.recompute', aggregateId: null },
    );

    if (!result) {
      throw new AppError(404, 'PROVIDER_NOT_FOUND', `No technician ${providerId}`, {
        messageKey: 'errors.providers.profileNotFound',
      });
    }

    res.status(200).json({
      providerId,
      score: result.score,
      badge: result.badge,
      suspended: result.suspended,
    });
  }),
);
