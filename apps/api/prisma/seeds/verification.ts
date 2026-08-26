import type { Prisma, PrismaClient, VerificationStatus } from '@prisma/client';
import { computeBadge } from '../../src/modules/verification/badge';
import { PROVIDER_SEEDS } from './providers';
import { deterministicUuid } from './deterministic-id';

/**
 * Verification histories for the seeded technicians.
 *
 * Written as event scripts rather than final states, because the whole point of
 * the design is that history is the truth — seeding a `passed` case with no
 * events would produce data the projection could not reproduce, and the
 * "projection equals fold(events)" test would rightly fail on it.
 */

type EventScript = {
  eventType:
    'submitted' | 'moved_to_review' | 'info_requested' | 'info_provided' | 'passed' | 'failed';
  actorType: 'provider' | 'ops' | 'system';
  /** Ops events get the ops user; provider events get the technician. */
  actor: 'provider' | 'ops';
  notes?: string;
  /** Minutes after the case opened, so histories look plausibly spaced. */
  afterMinutes: number;
};

/** Straight through: submitted, picked up, approved. */
const CLEAN_PASS: EventScript[] = [
  { eventType: 'submitted', actorType: 'provider', actor: 'provider', afterMinutes: 0 },
  { eventType: 'moved_to_review', actorType: 'ops', actor: 'ops', afterMinutes: 120 },
  {
    eventType: 'passed',
    actorType: 'ops',
    actor: 'ops',
    notes: 'Documents legible and consistent.',
    afterMinutes: 180,
  },
];

/** The realistic one: ops needed something clearer before they could decide. */
const PASS_WITH_DETOUR: EventScript[] = [
  { eventType: 'submitted', actorType: 'provider', actor: 'provider', afterMinutes: 0 },
  { eventType: 'moved_to_review', actorType: 'ops', actor: 'ops', afterMinutes: 90 },
  {
    eventType: 'info_requested',
    actorType: 'ops',
    actor: 'ops',
    notes: 'ID photo is blurred at the corner. Please re-upload in better light.',
    afterMinutes: 150,
  },
  {
    eventType: 'info_provided',
    actorType: 'provider',
    actor: 'provider',
    notes: 'Re-uploaded in daylight.',
    afterMinutes: 900,
  },
  {
    eventType: 'passed',
    actorType: 'ops',
    actor: 'ops',
    notes: 'Clear now. Approved.',
    afterMinutes: 1_020,
  },
];

const AWAITING_REVIEW: EventScript[] = [
  { eventType: 'submitted', actorType: 'provider', actor: 'provider', afterMinutes: 0 },
];

const IN_REVIEW: EventScript[] = [
  { eventType: 'submitted', actorType: 'provider', actor: 'provider', afterMinutes: 0 },
  { eventType: 'moved_to_review', actorType: 'ops', actor: 'ops', afterMinutes: 60 },
];

const WAITING_ON_PROVIDER: EventScript[] = [
  { eventType: 'submitted', actorType: 'provider', actor: 'provider', afterMinutes: 0 },
  { eventType: 'moved_to_review', actorType: 'ops', actor: 'ops', afterMinutes: 45 },
  {
    eventType: 'info_requested',
    actorType: 'ops',
    actor: 'ops',
    notes: 'Please add a second reference — the first number is unreachable.',
    afterMinutes: 200,
  },
];

const FINAL_STATUS: Record<string, VerificationStatus> = {
  submitted: 'submitted',
  moved_to_review: 'in_review',
  info_requested: 'needs_info',
  info_provided: 'in_review',
  passed: 'passed',
  failed: 'failed',
};

/** Level payloads, carrying only masked identity data. Never a full number. */
function payloadForLevel(level: number, index: number): Prisma.InputJsonValue {
  switch (level) {
    case 0:
      return {
        idType: 'aadhaar',
        // Last four digits only — the full number is never sent, stored or seeded.
        idLast4: String(1000 + ((index * 137) % 9000)).slice(-4),
        note: 'seed fixture',
      };
    case 1:
      return { consent: true, consentedAt: '2026-07-01T09:00:00.000Z' };
    case 2:
      return index % 2 === 0
        ? { tradeTest: true, notes: 'Bench test at the Adhartal hub.' }
        : { fieldAudit: true, notes: 'Observed on a live job.' };
    default:
      return {};
  }
}

interface CasePlan {
  level: number;
  script: EventScript[];
}

/**
 * 12 fully verified, 3 mid-pipeline, 2 untouched — of the 17 listed technicians.
 * Phase 5 search tests depend on this distribution.
 */
function planFor(index: number): CasePlan[] {
  // Providers 0–11: every level passed, some with a needs-info detour.
  if (index < 12) {
    return [0, 1, 2].map((level) => ({
      level,
      script: index % 4 === 1 && level === 0 ? PASS_WITH_DETOUR : CLEAN_PASS,
    }));
  }

  // Providers 12–14: part-way through, in three different states.
  if (index === 12) {
    return [
      { level: 0, script: CLEAN_PASS },
      { level: 1, script: IN_REVIEW },
    ];
  }
  if (index === 13) {
    return [
      { level: 0, script: CLEAN_PASS },
      { level: 1, script: CLEAN_PASS },
      { level: 2, script: WAITING_ON_PROVIDER },
    ];
  }
  if (index === 14) {
    return [{ level: 0, script: AWAITING_REVIEW }];
  }

  // Providers 15–16: listed but never started verification.
  return [];
}

export interface VerificationSeedSummary {
  verified: number;
  inProgress: number;
  untouched: number;
}

export async function seedVerification(
  prisma: PrismaClient,
  opsUserId: string,
): Promise<VerificationSeedSummary> {
  // Only the 17 listed technicians get histories; the 3 incomplete ones stay clean.
  const listedSeeds = PROVIDER_SEEDS.filter((_, index) => index < 17);

  let verified = 0;
  let inProgress = 0;
  let untouched = 0;

  for (const [index, seed] of listedSeeds.entries()) {
    const user = await prisma.user.findUnique({ where: { phone: seed.phone } });
    if (!user) throw new Error(`verification seed: no user for ${seed.phone}`);

    const plans = planFor(index);

    if (plans.length === 0) {
      untouched += 1;
      await prisma.providerVerificationSummary.upsert({
        where: { providerId: user.id },
        update: { levelsPassed: [], badge: 'NONE', badgeSince: null },
        create: { providerId: user.id, levelsPassed: [], badge: 'NONE', badgeSince: null },
      });
      continue;
    }

    const passedLevels: number[] = [];

    for (const plan of plans) {
      const caseId = deterministicUuid(`case:${seed.phone}:${plan.level}`);
      const openedAt = new Date(Date.UTC(2026, 6, 10 + plan.level, 9, 0, 0));
      const last = plan.script[plan.script.length - 1];
      if (!last) continue;

      const status = FINAL_STATUS[last.eventType] ?? 'submitted';
      const closedAt =
        status === 'passed' || status === 'failed'
          ? new Date(openedAt.getTime() + last.afterMinutes * 60_000)
          : null;

      if (status === 'passed') passedLevels.push(plan.level);

      // Upsert-then-rebuild would need DELETE on an append-only table, so the
      // seed simply skips cases it has already written. Reruns are no-ops.
      const existing = await prisma.verificationCase.findUnique({ where: { id: caseId } });
      if (existing) continue;

      await prisma.verificationCase.create({
        data: {
          id: caseId,
          providerId: user.id,
          level: plan.level,
          status,
          openedAt,
          closedAt,
          events: {
            create: plan.script.map((event) => ({
              eventType: event.eventType,
              actorType: event.actorType,
              actorUserId: event.actor === 'ops' ? opsUserId : user.id,
              notes: event.notes ?? null,
              payload:
                event.eventType === 'submitted' ? payloadForLevel(plan.level, index) : undefined,
              createdAt: new Date(openedAt.getTime() + event.afterMinutes * 60_000),
            })),
          },
        },
      });
    }

    const badge = computeBadge(passedLevels);
    if (badge === 'VERIFIED') verified += 1;
    else inProgress += 1;

    await prisma.providerVerificationSummary.upsert({
      where: { providerId: user.id },
      update: {
        levelsPassed: passedLevels,
        badge,
        badgeSince: badge === 'NONE' ? null : new Date(Date.UTC(2026, 6, 14, 12, 0, 0)),
      },
      create: {
        providerId: user.id,
        levelsPassed: passedLevels,
        badge,
        badgeSince: badge === 'NONE' ? null : new Date(Date.UTC(2026, 6, 14, 12, 0, 0)),
      },
    });
  }

  console.log(
    `verification ready: ${verified} VERIFIED, ${inProgress} in progress, ${untouched} not started`,
  );

  return { verified, inProgress, untouched };
}
