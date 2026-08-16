import { Router, type Request, type RequestHandler } from 'express';
import { AUDIT_ACTIONS, auditActor, type AuditEntry } from '../../core/audit';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import * as service from './service';
import { isVerificationLevel, type VerificationLevel } from './state-machine';
import { AppError } from '../../core/errors';
import {
  caseIdParamSchema,
  decideSchema,
  documentIdParamSchema,
  levelParamSchema,
  provideInfoSchema,
  queueQuerySchema,
  requestUploadUrlSchema,
} from './types';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.VerificationDeps => ({ context: getContext(req) });

/**
 * The same deps carrying the ops decision's audit entry.
 *
 * It travels down to `repo.appendEvent`, which owns the transaction the case
 * event and the status projection are written in — so a decision that rolls back
 * leaves no record claiming it was taken.
 */
const opsDeps = (req: Request, entry: AuditEntry): service.VerificationDeps => ({
  context: getContext(req),
  audit: { actor: auditActor(req), entry },
});

/* -------------------------------------------------------------------------- */
/* Provider-facing — /api/v1/verification                                     */
/* -------------------------------------------------------------------------- */

export const router = Router();

/** A technician's own KYC only. Ownership is scoped by the caller's id throughout. */
router.use(authenticate, requireRoles('technician'));

/* ---- documents ---- */

router.post(
  '/documents/upload-url',
  handle(async (req, res) => {
    const input = requestUploadUrlSchema.parse(req.body);
    const result = await service.requestUploadUrl(deps(req), getAuthUser(req).id, input);

    res.status(201).json({
      document: result.document,
      upload: result.upload,
      message: req.t('verification.uploadUrlIssued'),
    });
  }),
);

router.post(
  '/documents/:documentId/confirm',
  handle(async (req, res) => {
    const { documentId } = documentIdParamSchema.parse(req.params);
    const document = await service.confirmUpload(deps(req), getAuthUser(req).id, documentId);

    res.status(200).json({ document, message: req.t('verification.documentUploaded') });
  }),
);

router.get(
  '/documents',
  handle(async (req, res) => {
    const documents = await service.listDocuments(deps(req), getAuthUser(req).id);
    res.status(200).json({ documents });
  }),
);

router.get(
  '/documents/:documentId/download-url',
  handle(async (req, res) => {
    const { documentId } = documentIdParamSchema.parse(req.params);
    const result = await service.getOwnDownloadUrl(deps(req), getAuthUser(req).id, documentId);

    res.status(200).json(result);
  }),
);

/* ---- cases ---- */

function parseLevel(req: Request): VerificationLevel {
  const { level } = levelParamSchema.parse(req.params);

  if (!isVerificationLevel(level)) {
    throw AppError.badRequest(`${level} is not a verification level`, {
      messageKey: 'errors.verification.unknownLevel',
    });
  }

  return level;
}

router.post(
  '/levels/:level/submit',
  handle(async (req, res) => {
    const record = await service.submitLevel(
      deps(req),
      getAuthUser(req).id,
      parseLevel(req),
      req.body,
    );

    res.status(201).json({ case: record, message: req.t('verification.submitted') });
  }),
);

router.get(
  '/cases',
  handle(async (req, res) => {
    const userId = getAuthUser(req).id;

    res.status(200).json({
      cases: await service.listOwnCases(deps(req), userId),
      summary: await service.getSummary(deps(req), userId),
    });
  }),
);

router.get(
  '/cases/:caseId',
  handle(async (req, res) => {
    const { caseId } = caseIdParamSchema.parse(req.params);
    const record = await service.getOwnCase(deps(req), getAuthUser(req).id, caseId);

    res.status(200).json({ case: record });
  }),
);

router.post(
  '/cases/:caseId/info',
  handle(async (req, res) => {
    const { caseId } = caseIdParamSchema.parse(req.params);
    const input = provideInfoSchema.parse(req.body);
    const record = await service.provideInfo(deps(req), getAuthUser(req).id, caseId, input);

    res.status(200).json({ case: record, message: req.t('verification.infoProvided') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Ops-facing — /api/v1/admin/verification                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mounted under the admin prefix because that is where reviewers will look for
 * it, but the code lives here with the domain it belongs to. The `admin` module
 * stays empty until Phase 11 builds the console around these.
 */
export const opsRouter = Router();

opsRouter.use(authenticate, requireRoles('ops', 'admin'));

opsRouter.get(
  '/queue',
  handle(async (req, res) => {
    const query = queueQuerySchema.parse(req.query);
    res.status(200).json(await service.listQueue(deps(req), query));
  }),
);

opsRouter.get(
  '/cases/:caseId',
  handle(async (req, res) => {
    const { caseId } = caseIdParamSchema.parse(req.params);
    const detail = await service.getCaseForOps(deps(req), getAuthUser(req).id, caseId);

    res.status(200).json(detail);
  }),
);

opsRouter.post(
  '/cases/:caseId/review',
  handle(async (req, res) => {
    const { caseId } = caseIdParamSchema.parse(req.params);

    const record = await service.moveToReview(
      opsDeps(req, {
        action: AUDIT_ACTIONS.verificationReview,
        targetType: 'verification_case',
        targetId: caseId,
        payload: {},
      }),
      getAuthUser(req).id,
      caseId,
    );

    res.status(200).json({ case: record });
  }),
);

opsRouter.post(
  '/cases/:caseId/decide',
  handle(async (req, res) => {
    const { caseId } = caseIdParamSchema.parse(req.params);
    const input = decideSchema.parse(req.body);

    const result = await service.decide(
      opsDeps(req, {
        action: AUDIT_ACTIONS.verificationDecide,
        targetType: 'verification_case',
        targetId: caseId,
        /**
         * The decision and the note, verbatim.
         *
         * This is the audit row somebody will read when a technician says they
         * were failed unfairly, and "outcome: fail" on its own answers nothing.
         */
        payload: { decision: input.decision, notes: input.notes ?? null },
      }),
      getAuthUser(req).id,
      caseId,
      input,
    );

    res.status(200).json({ ...result, message: req.t('verification.decisionRecorded') });
  }),
);
