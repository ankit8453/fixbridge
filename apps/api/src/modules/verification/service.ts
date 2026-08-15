import { randomUUID } from 'node:crypto';
import type { Prisma, ProviderDocument, VerificationEvent } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { kycObjectKey } from '../../core/storage';
import * as repo from './repository';
import { computeBadge, nextBadgeSince, remainingLevels, type Badge } from './badge';
import {
  LEVEL_NAMES,
  applyEvent,
  decisionRequiresNotes,
  isTerminal,
  projectStatus,
  DECISION_EVENT,
  type OpsDecision,
  type VerificationEventType,
  type VerificationLevel,
  type VerificationStatus,
} from './state-machine';
import {
  isIdentityScanExempt,
  looksLikeFullIdNumber,
  redactPayloadForProvider,
  requiredDocumentIds,
  schemaForLevel,
  type LevelPayload,
} from './requirements';
import type {
  DecideInput,
  DocumentResponse,
  ProvideInfoInput,
  QueueQuery,
  RequestUploadUrlInput,
  VerificationCaseResponse,
  VerificationSummaryResponse,
} from './types';

export interface VerificationDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: VerificationDeps): Date => (deps.now ? deps.now() : new Date());

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

const documentNotFound = (id: string): AppError =>
  new AppError(404, 'DOCUMENT_NOT_FOUND', `Document ${id} not found for this provider`, {
    messageKey: 'errors.verification.documentNotFound',
  });

const caseNotFound = (id: string): AppError =>
  new AppError(404, 'VERIFICATION_CASE_NOT_FOUND', `Case ${id} not found`, {
    messageKey: 'errors.verification.caseNotFound',
  });

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

function toDocumentResponse(document: ProviderDocument): DocumentResponse {
  return {
    id: document.id,
    docType: document.docType,
    status: document.status,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    uploadedAt: document.uploadedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
  };
}

/**
 * Hands back a pre-signed PUT URL and records the intent.
 *
 * The API never sees the bytes: the client uploads straight to storage and then
 * confirms. That keeps KYC images out of our process memory, our request logs
 * and our bandwidth entirely.
 */
export async function requestUploadUrl(
  deps: VerificationDeps,
  providerId: string,
  input: RequestUploadUrlInput,
): Promise<{
  document: DocumentResponse;
  upload: Awaited<ReturnType<AppContext['storage']['getUploadUrl']>>;
}> {
  const { context } = deps;

  if (input.sizeBytes > context.config.STORAGE_MAX_UPLOAD_BYTES) {
    throw AppError.badRequest(
      `File is ${input.sizeBytes} bytes; the limit is ${context.config.STORAGE_MAX_UPLOAD_BYTES}`,
      {
        messageKey: 'errors.verification.fileTooLarge',
        details: { maxBytes: context.config.STORAGE_MAX_UPLOAD_BYTES },
      },
    );
  }

  const documentId = randomUUID();
  const storageKey = kycObjectKey(providerId, input.docType, documentId);

  const upload = await context.storage.getUploadUrl({
    key: storageKey,
    contentType: input.contentType,
    contentLength: input.sizeBytes,
  });

  const document = await repo.createDocument(context.prisma, {
    id: documentId,
    providerId,
    docType: input.docType,
    storageKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  return { document: toDocumentResponse(document), upload };
}

/**
 * Confirms an upload actually landed.
 *
 * Trusting the client's "done!" would let a case be submitted against documents
 * that were never uploaded, so the object is checked and its real size recorded.
 */
export async function confirmUpload(
  deps: VerificationDeps,
  providerId: string,
  documentId: string,
): Promise<DocumentResponse> {
  const { context } = deps;
  const document = await repo.findDocument(context.prisma, providerId, documentId);

  if (!document) throw documentNotFound(documentId);
  if (document.status === 'uploaded') return toDocumentResponse(document);

  const stored = await context.storage.head(document.storageKey);

  if (!stored) {
    throw new AppError(409, 'UPLOAD_NOT_FOUND', 'No object exists at the expected key yet', {
      messageKey: 'errors.verification.uploadMissing',
    });
  }

  // Belt and braces: the signed Content-Length should already have stopped this.
  if (stored.sizeBytes > context.config.STORAGE_MAX_UPLOAD_BYTES) {
    await context.storage.delete(document.storageKey);

    throw AppError.badRequest('Uploaded file exceeds the size limit and has been discarded', {
      messageKey: 'errors.verification.fileTooLarge',
      details: { maxBytes: context.config.STORAGE_MAX_UPLOAD_BYTES },
    });
  }

  const updated = await repo.markDocumentUploaded(
    context.prisma,
    documentId,
    stored.sizeBytes,
    nowOf(deps),
  );

  context.logger.info(
    { providerId, documentId, docType: document.docType, sizeBytes: stored.sizeBytes },
    'kyc document uploaded',
  );

  return toDocumentResponse(updated);
}

export async function listDocuments(
  deps: VerificationDeps,
  providerId: string,
): Promise<DocumentResponse[]> {
  const documents = await repo.listDocuments(deps.context.prisma, providerId);
  return documents.map(toDocumentResponse);
}

export async function getOwnDownloadUrl(
  deps: VerificationDeps,
  providerId: string,
  documentId: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  const { context } = deps;
  const document = await repo.findDocument(context.prisma, providerId, documentId);

  if (!document || document.status !== 'uploaded') throw documentNotFound(documentId);

  return {
    url: await context.storage.getDownloadUrl(document.storageKey),
    expiresInSeconds: context.config.STORAGE_DOWNLOAD_URL_TTL_SECONDS,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

function toCaseResponse(
  record: repo.CaseWithEvents,
  audience: 'provider' | 'ops',
): VerificationCaseResponse {
  return {
    id: record.id,
    level: record.level,
    levelName: LEVEL_NAMES[record.level as VerificationLevel] ?? String(record.level),
    status: record.status,
    openedAt: record.openedAt.toISOString(),
    closedAt: record.closedAt?.toISOString() ?? null,
    events: record.events.map((event: VerificationEvent) => ({
      id: event.id,
      eventType: event.eventType,
      actorType: event.actorType,
      /**
       * Ops notes are an internal record — "photo looks doctored", "called the
       * reference, no answer". A provider sees that a decision happened and its
       * type, never the reviewer's reasoning.
       */
      notes: audience === 'ops' ? event.notes : null,
      payload:
        audience === 'ops' ? (event.payload ?? null) : redactPayloadForProvider(event.payload),
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function listOwnCases(
  deps: VerificationDeps,
  providerId: string,
): Promise<VerificationCaseResponse[]> {
  const cases = await repo.listCasesForProvider(deps.context.prisma, providerId);
  return cases.map((record) => toCaseResponse(record, 'provider'));
}

export async function getOwnCase(
  deps: VerificationDeps,
  providerId: string,
  caseId: string,
): Promise<VerificationCaseResponse> {
  const record = await repo.findCaseWithEvents(deps.context.prisma, caseId);

  // Ownership checked here rather than in the query so the 404 is identical
  // whether the case is missing or belongs to somebody else.
  if (!record || record.providerId !== providerId) throw caseNotFound(caseId);

  return toCaseResponse(record, 'provider');
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Recomputes the badge from the current state of every level.
 *
 * Always derived, never incremented: a failed re-check on one level drops the
 * badge with no separate downgrade path to get wrong.
 */
export async function recomputeBadge(
  deps: VerificationDeps,
  providerId: string,
): Promise<VerificationSummaryResponse> {
  const { context } = deps;
  const now = nowOf(deps);

  const passedLevels = await repo.currentlyPassedLevels(context.prisma, providerId);
  const existing = await repo.findSummary(context.prisma, providerId);

  const previousBadge = (existing?.badge ?? 'NONE') as Badge;
  const badge = computeBadge(passedLevels);
  const badgeSince = nextBadgeSince(previousBadge, badge, existing?.badgeSince ?? null, now);

  await repo.saveSummary(context.prisma, providerId, passedLevels, badge, badgeSince);

  if (previousBadge !== badge) {
    context.logger.info(
      { providerId, previousBadge, badge, passedLevels },
      badge === 'NONE' ? 'verification badge withdrawn' : 'verification badge awarded',
    );
  }

  return {
    badge,
    badgeSince: badgeSince?.toISOString() ?? null,
    levelsPassed: passedLevels,
    levelsRemaining: remainingLevels(passedLevels),
  };
}

export async function getSummary(
  deps: VerificationDeps,
  providerId: string,
): Promise<VerificationSummaryResponse> {
  const summary = await repo.findSummary(deps.context.prisma, providerId);

  if (!summary) {
    return { badge: 'NONE', badgeSince: null, levelsPassed: [], levelsRemaining: [0, 1, 2, 3] };
  }

  return {
    badge: summary.badge as Badge,
    badgeSince: summary.badgeSince?.toISOString() ?? null,
    levelsPassed: summary.levelsPassed,
    levelsRemaining: remainingLevels(summary.levelsPassed),
  };
}

/* -------------------------------------------------------------------------- */
/* Submission                                                                 */
/* -------------------------------------------------------------------------- */

/** Guards against a full identity number arriving in any string field. */
function assertNoFullIdNumbers(payload: unknown): void {
  const scan = (value: unknown): void => {
    if (typeof value === 'string' && looksLikeFullIdNumber(value)) {
      throw AppError.badRequest(
        'A field looks like a full identity number. Send only the last 4 digits.',
        { messageKey: 'errors.verification.rawIdNumber' },
      );
    }

    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }

    if (value !== null && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(scan);
    }
  };

  if (payload !== null && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      // Document ids and phone numbers are legitimately long digit strings.
      if (isIdentityScanExempt(key)) continue;
      scan(value);
    }
  }
}

export async function submitLevel(
  deps: VerificationDeps,
  providerId: string,
  level: VerificationLevel,
  body: unknown,
): Promise<VerificationCaseResponse> {
  const { context } = deps;

  assertNoFullIdNumbers(body);

  const parsed = schemaForLevel(level).safeParse(body);
  if (!parsed.success) throw parsed.error;

  const payload = parsed.data as LevelPayload;

  // Only one live case per level — the partial unique index enforces this too,
  // but a 409 with a reason beats a constraint violation.
  const open = await repo.findOpenCase(context.prisma, providerId, level);
  if (open) {
    throw new AppError(
      409,
      'VERIFICATION_ALREADY_OPEN',
      `Level ${level} already has an open case`,
      {
        messageKey: 'errors.verification.levelAlreadyOpen',
        details: { level, caseId: open.id, status: open.status },
      },
    );
  }

  // Every document the level depends on must exist, belong to this provider,
  // and have actually been uploaded.
  const documentIds = requiredDocumentIds(level, payload);
  if (documentIds.length > 0) {
    const documents = await repo.findDocumentsByIds(context.prisma, providerId, documentIds);
    const usable = new Set(
      documents.filter((doc) => doc.status === 'uploaded').map((doc) => doc.id),
    );

    const missing = documentIds.filter((id) => !usable.has(id));
    if (missing.length > 0) {
      throw AppError.badRequest('Some documents are missing or not uploaded yet', {
        messageKey: 'errors.verification.documentsNotReady',
        details: { missingDocumentIds: missing },
      });
    }
  }

  const record = await repo.openCase(context.prisma, {
    id: randomUUID(),
    providerId,
    level,
    actorUserId: providerId,
    payload: {
      ...(payload as Record<string, unknown>),
      submittedAt: nowOf(deps).toISOString(),
    } as Prisma.InputJsonValue,
  });

  context.logger.info({ providerId, level, caseId: record.id }, 'verification level submitted');

  return toCaseResponse(record, 'provider');
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The single funnel for every state change.
 *
 * Reprojects the status from the events before deciding, so the cached column
 * can never be what a transition is judged against — if the two ever disagreed,
 * the log wins.
 */
async function transition(
  deps: VerificationDeps,
  caseId: string,
  event: {
    eventType: VerificationEventType;
    actorType: 'provider' | 'ops' | 'system';
    actorUserId: string | null;
    notes?: string | null;
    payload?: Prisma.InputJsonValue;
  },
): Promise<repo.CaseWithEvents> {
  const { context } = deps;
  const record = await repo.findCaseWithEvents(context.prisma, caseId);
  if (!record) throw caseNotFound(caseId);

  const current = projectStatus(record.events);
  const result = applyEvent(current, event.eventType);

  if (!result.ok) {
    throw new AppError(
      409,
      'VERIFICATION_INVALID_TRANSITION',
      `${event.eventType} is not valid from ${current} (${result.reason})`,
      {
        messageKey:
          result.reason === 'terminal'
            ? 'errors.verification.caseClosed'
            : 'errors.verification.invalidTransition',
        details: { from: current, event: event.eventType },
      },
    );
  }

  const now = nowOf(deps);
  const closedAt = isTerminal(result.status) ? now : null;

  return repo.appendEvent(context.prisma, { caseId, ...event }, result.status, closedAt);
}

export async function provideInfo(
  deps: VerificationDeps,
  providerId: string,
  caseId: string,
  input: ProvideInfoInput,
): Promise<VerificationCaseResponse> {
  const existing = await repo.findCaseWithEvents(deps.context.prisma, caseId);
  if (!existing || existing.providerId !== providerId) throw caseNotFound(caseId);

  const record = await transition(deps, caseId, {
    eventType: 'info_provided',
    actorType: 'provider',
    actorUserId: providerId,
    notes: input.notes,
    ...(input.documentIds ? { payload: { documentIds: input.documentIds } } : {}),
  });

  return toCaseResponse(record, 'provider');
}

/**
 * An ops decision. `pass` and `fail` are terminal, so the badge is recomputed
 * immediately afterwards — including downgrading it when a re-check fails.
 */
export async function decide(
  deps: VerificationDeps,
  opsUserId: string,
  caseId: string,
  input: DecideInput,
): Promise<{ case: VerificationCaseResponse; summary: VerificationSummaryResponse | null }> {
  const { context } = deps;

  if (decisionRequiresNotes(input.decision) && !input.notes) {
    throw AppError.badRequest(`notes are required when the decision is ${input.decision}`, {
      messageKey: 'errors.verification.notesRequired',
    });
  }

  const existing = await repo.findCaseWithEvents(context.prisma, caseId);
  if (!existing) throw caseNotFound(caseId);

  const record = await transition(deps, caseId, {
    eventType: DECISION_EVENT[input.decision as OpsDecision],
    actorType: 'ops',
    actorUserId: opsUserId,
    notes: input.notes ?? null,
  });

  await repo.recordKycAccess(context.prisma, {
    providerId: existing.providerId,
    actorUserId: opsUserId,
    caseId,
    documentIds: [],
    action: `decide:${input.decision}`,
  });

  const summary =
    record.status === 'passed' || record.status === 'failed'
      ? await recomputeBadge(deps, existing.providerId)
      : null;

  context.logger.info(
    {
      caseId,
      providerId: existing.providerId,
      opsUserId,
      decision: input.decision,
      status: record.status,
      badge: summary?.badge,
    },
    'verification decision recorded',
  );

  return { case: toCaseResponse(record, 'ops'), summary };
}

export async function moveToReview(
  deps: VerificationDeps,
  opsUserId: string,
  caseId: string,
): Promise<VerificationCaseResponse> {
  const record = await transition(deps, caseId, {
    eventType: 'moved_to_review',
    actorType: 'ops',
    actorUserId: opsUserId,
  });

  return toCaseResponse(record, 'ops');
}

/** Records a third-party answer. Evidence, not a decision — ops still choose. */
export async function recordAdapterResult(
  deps: VerificationDeps,
  caseId: string,
  result: { referenceToken: string; outcome: string; summary?: string },
): Promise<VerificationCaseResponse> {
  const record = await transition(deps, caseId, {
    eventType: 'adapter_result_received',
    actorType: 'system',
    actorUserId: null,
    notes: result.summary ?? null,
    payload: { referenceToken: result.referenceToken, outcome: result.outcome },
  });

  return toCaseResponse(record, 'ops');
}

/* -------------------------------------------------------------------------- */
/* Ops queue and case detail                                                  */
/* -------------------------------------------------------------------------- */

export async function listQueue(
  deps: VerificationDeps,
  query: QueueQuery,
): Promise<{
  cases: repo.QueueRow[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const { rows, total } = await repo.listQueue(deps.context.prisma, {
    ...(query.status ? { status: query.status } : {}),
    ...(query.level === undefined ? {} : { level: query.level }),
    ...(query.cityId === undefined ? {} : { cityId: query.cityId }),
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  return { cases: rows, page: query.page, pageSize: query.pageSize, total };
}

/**
 * Full case detail for a reviewer, with signed URLs for the attached documents.
 *
 * Handing out those URLs *is* access to KYC material, so it writes a
 * `kyc_access_logs` row naming the reviewer and the documents. Ops reads have to
 * be reconstructable, not just ops decisions.
 */
export async function getCaseForOps(
  deps: VerificationDeps,
  opsUserId: string,
  caseId: string,
): Promise<{
  case: VerificationCaseResponse;
  provider: { id: string; displayName: string | null; cityId: number };
  documents: (DocumentResponse & { downloadUrl: string })[];
  summary: VerificationSummaryResponse;
}> {
  const { context } = deps;

  const record = await repo.findCaseWithEvents(context.prisma, caseId);
  if (!record) throw caseNotFound(caseId);

  const profile = await context.prisma.providerProfile.findUnique({
    where: { userId: record.providerId },
    select: { userId: true, displayName: true, cityId: true },
  });
  if (!profile) throw caseNotFound(caseId);

  const documents = await repo.listDocuments(context.prisma, record.providerId);
  const uploaded = documents.filter((doc) => doc.status === 'uploaded');

  const withUrls = await Promise.all(
    uploaded.map(async (doc) => ({
      ...toDocumentResponse(doc),
      downloadUrl: await context.storage.getDownloadUrl(doc.storageKey),
    })),
  );

  await repo.recordKycAccess(context.prisma, {
    providerId: record.providerId,
    actorUserId: opsUserId,
    caseId,
    documentIds: uploaded.map((doc) => doc.id),
    action: 'view_case',
  });

  return {
    case: toCaseResponse(record, 'ops'),
    provider: { id: profile.userId, displayName: profile.displayName, cityId: profile.cityId },
    documents: withUrls,
    summary: await getSummary(deps, record.providerId),
  };
}

export type { VerificationStatus };
