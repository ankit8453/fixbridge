// All Prisma access for the verification domain.
import type {
  Badge,
  Prisma,
  PrismaClient,
  ProviderDocument,
  ProviderDocumentStatus,
  ProviderDocumentType,
  ProviderVerificationSummary,
  VerificationCase,
  VerificationEvent,
  VerificationEventType,
  VerificationStatus,
} from '@prisma/client';

export type CaseWithEvents = VerificationCase & { events: VerificationEvent[] };

/** Statuses a case can still move out of. */
export const OPEN_STATUSES: VerificationStatus[] = ['submitted', 'in_review', 'needs_info'];

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export function createDocument(
  prisma: PrismaClient,
  input: {
    id: string;
    providerId: string;
    docType: ProviderDocumentType;
    storageKey: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<ProviderDocument> {
  return prisma.providerDocument.create({ data: input });
}

export function findDocument(
  prisma: PrismaClient,
  providerId: string,
  documentId: string,
): Promise<ProviderDocument | null> {
  // Scoped by provider: another technician's document is simply not found.
  return prisma.providerDocument.findFirst({ where: { id: documentId, providerId } });
}

export function findDocumentsByIds(
  prisma: PrismaClient,
  providerId: string,
  ids: string[],
): Promise<ProviderDocument[]> {
  return prisma.providerDocument.findMany({ where: { providerId, id: { in: ids } } });
}

export function listDocuments(
  prisma: PrismaClient,
  providerId: string,
): Promise<ProviderDocument[]> {
  return prisma.providerDocument.findMany({
    where: { providerId },
    orderBy: { createdAt: 'desc' },
  });
}

export function markDocumentUploaded(
  prisma: PrismaClient,
  documentId: string,
  sizeBytes: number,
  now: Date,
): Promise<ProviderDocument> {
  return prisma.providerDocument.update({
    where: { id: documentId },
    data: { status: 'uploaded' satisfies ProviderDocumentStatus, sizeBytes, uploadedAt: now },
  });
}

export async function deleteDocument(
  prisma: PrismaClient,
  providerId: string,
  documentId: string,
): Promise<boolean> {
  const result = await prisma.providerDocument.deleteMany({
    where: { id: documentId, providerId },
  });
  return result.count > 0;
}

/* -------------------------------------------------------------------------- */
/* Cases and events                                                           */
/* -------------------------------------------------------------------------- */

export function findOpenCase(
  prisma: PrismaClient,
  providerId: string,
  level: number,
): Promise<VerificationCase | null> {
  return prisma.verificationCase.findFirst({
    where: { providerId, level, status: { in: OPEN_STATUSES } },
  });
}

export function findCaseWithEvents(
  prisma: PrismaClient,
  caseId: string,
): Promise<CaseWithEvents | null> {
  return prisma.verificationCase.findUnique({
    where: { id: caseId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
}

export function listCasesForProvider(
  prisma: PrismaClient,
  providerId: string,
): Promise<CaseWithEvents[]> {
  return prisma.verificationCase.findMany({
    where: { providerId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ level: 'asc' }, { openedAt: 'desc' }],
  });
}

export interface EventInput {
  caseId: string;
  eventType: VerificationEventType;
  actorType: 'provider' | 'ops' | 'system';
  actorUserId: string | null;
  notes?: string | null;
  payload?: Prisma.InputJsonValue | undefined;
}

/**
 * Opens a case and writes its first event in one transaction.
 *
 * A case without its `submitted` event could not be projected, so the two are
 * never separately observable.
 */
export function openCase(
  prisma: PrismaClient,
  input: {
    id: string;
    providerId: string;
    level: number;
    actorUserId: string;
    payload: Prisma.InputJsonValue;
    notes?: string | null;
  },
): Promise<CaseWithEvents> {
  return prisma.verificationCase.create({
    data: {
      id: input.id,
      providerId: input.providerId,
      level: input.level,
      status: 'submitted',
      events: {
        create: {
          eventType: 'submitted',
          actorType: 'provider',
          actorUserId: input.actorUserId,
          notes: input.notes ?? null,
          payload: input.payload,
        },
      },
    },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
}

/**
 * Appends an event and updates the cached projection in one transaction.
 *
 * The event is the truth and `status` is a convenience copy, so they must never
 * be observable apart — a reader that saw the event without the new status, or
 * vice versa, would draw the wrong conclusion.
 */
export async function appendEvent(
  prisma: PrismaClient,
  event: EventInput,
  nextStatus: VerificationStatus,
  closedAt: Date | null,
): Promise<CaseWithEvents> {
  return prisma.$transaction(async (tx) => {
    await tx.verificationEvent.create({
      data: {
        caseId: event.caseId,
        eventType: event.eventType,
        actorType: event.actorType,
        actorUserId: event.actorUserId,
        notes: event.notes ?? null,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
      },
    });

    await tx.verificationCase.update({
      where: { id: event.caseId },
      data: { status: nextStatus, closedAt },
    });

    const updated = await tx.verificationCase.findUnique({
      where: { id: event.caseId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });

    if (!updated) throw new Error(`case ${event.caseId} vanished mid-transaction`);
    return updated;
  });
}

/* -------------------------------------------------------------------------- */
/* Ops queue                                                                  */
/* -------------------------------------------------------------------------- */

export interface QueueFilters {
  status?: VerificationStatus;
  level?: number;
  cityId?: number;
  skip: number;
  take: number;
}

export interface QueueRow {
  caseId: string;
  providerId: string;
  providerName: string | null;
  cityId: number;
  level: number;
  status: VerificationStatus;
  openedAt: Date;
}

/**
 * Oldest first: a review queue that surfaces the newest submissions starves the
 * people who have been waiting longest.
 */
export async function listQueue(
  prisma: PrismaClient,
  filters: QueueFilters,
): Promise<{ rows: QueueRow[]; total: number }> {
  const where: Prisma.VerificationCaseWhereInput = {
    status: filters.status ?? { in: OPEN_STATUSES },
    ...(filters.level === undefined ? {} : { level: filters.level }),
    ...(filters.cityId === undefined ? {} : { provider: { cityId: filters.cityId } }),
  };

  const [rows, total] = await Promise.all([
    prisma.verificationCase.findMany({
      where,
      include: { provider: { select: { displayName: true, cityId: true } } },
      orderBy: { openedAt: 'asc' },
      skip: filters.skip,
      take: filters.take,
    }),
    prisma.verificationCase.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      caseId: row.id,
      providerId: row.providerId,
      providerName: row.provider.displayName,
      cityId: row.provider.cityId,
      level: row.level,
      status: row.status,
      openedAt: row.openedAt,
    })),
    total,
  };
}

/* -------------------------------------------------------------------------- */
/* Summary and badge                                                          */
/* -------------------------------------------------------------------------- */

export function findSummary(
  prisma: PrismaClient,
  providerId: string,
): Promise<ProviderVerificationSummary | null> {
  return prisma.providerVerificationSummary.findUnique({ where: { providerId } });
}

export function saveSummary(
  prisma: PrismaClient,
  providerId: string,
  levelsPassed: number[],
  badge: Badge,
  badgeSince: Date | null,
): Promise<ProviderVerificationSummary> {
  return prisma.providerVerificationSummary.upsert({
    where: { providerId },
    update: { levelsPassed, badge, badgeSince },
    create: { providerId, levelsPassed, badge, badgeSince },
  });
}

/**
 * The levels a provider currently holds, read from the cases themselves.
 *
 * Deliberately derived rather than accumulated: a later failed re-check for a
 * level simply stops appearing here, so the badge downgrades on its own instead
 * of relying on someone remembering to subtract.
 */
export async function currentlyPassedLevels(
  prisma: PrismaClient,
  providerId: string,
): Promise<number[]> {
  const cases = await prisma.verificationCase.findMany({
    where: { providerId, status: { in: ['passed', 'failed'] } },
    select: { level: true, status: true, closedAt: true },
    orderBy: { closedAt: 'asc' },
  });

  // Last closed case per level wins: a failed re-check overrides an earlier pass.
  const latestByLevel = new Map<number, VerificationStatus>();
  for (const row of cases) {
    latestByLevel.set(row.level, row.status);
  }

  return [...latestByLevel.entries()]
    .filter(([, status]) => status === 'passed')
    .map(([level]) => level)
    .sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */
/* Ops access log                                                             */
/* -------------------------------------------------------------------------- */

export async function recordKycAccess(
  prisma: PrismaClient,
  input: {
    providerId: string;
    actorUserId: string;
    caseId?: string | null;
    documentIds: string[];
    action: string;
  },
): Promise<void> {
  await prisma.kycAccessLog.create({
    data: {
      providerId: input.providerId,
      actorUserId: input.actorUserId,
      caseId: input.caseId ?? null,
      documentIds: input.documentIds,
      action: input.action,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Erasure                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The one sanctioned way to remove verification history.
 *
 * `verification_events` refuses DELETE by trigger, so erasure has to announce
 * itself with a session flag. `SET LOCAL` binds to the transaction, which is
 * what keeps the exemption from leaking to another request sharing the pool.
 *
 * Used by test teardown today and by DPDP erasure (Phase 15) tomorrow. It is not
 * a general-purpose delete and must not become one.
 */
export async function purgeVerificationData(
  prisma: PrismaClient,
  providerIds: string[],
): Promise<void> {
  if (providerIds.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL "fixbridge.allow_kyc_purge" = 'on'`);
    await tx.verificationCase.deleteMany({ where: { providerId: { in: providerIds } } });
    await tx.providerVerificationSummary.deleteMany({
      where: { providerId: { in: providerIds } },
    });
    await tx.kycAccessLog.deleteMany({ where: { providerId: { in: providerIds } } });
  });
}
