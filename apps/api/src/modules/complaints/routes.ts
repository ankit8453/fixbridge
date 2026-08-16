import { Router, type Request, type RequestHandler } from 'express';
import { AUDIT_ACTIONS, auditActor, type AuditEntry } from '../../core/audit';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { bookingIdParamSchema } from '../bookings/types';
import * as service from './service';
import {
  complaintIdParamSchema,
  complaintQueueQuerySchema,
  dismissComplaintSchema,
  raiseComplaintSchema,
  resolveComplaintSchema,
} from './types';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.ComplaintDeps => ({ context: getContext(req) });

/** The same deps carrying the ops decision's audit entry into the service's own transaction. */
const opsDeps = (req: Request, entry: AuditEntry): service.ComplaintDeps => ({
  context: getContext(req),
  audit: { actor: auditActor(req), entry },
});

const hasOpsRole = (req: Request): boolean => {
  const roles = getAuthUser(req).roles as readonly string[];
  return roles.includes('ops') || roles.includes('admin');
};

/* -------------------------------------------------------------------------- */
/* /api/v1/complaints                                                         */
/* -------------------------------------------------------------------------- */

export const router = Router();

router.use(authenticate);

/** Complaints this person raised, and complaints against them. */
router.get(
  '/',
  handle(async (req, res) => {
    const complaints = await service.listMyComplaints(deps(req), getAuthUser(req).id);
    res.status(200).json({ complaints });
  }),
);

router.get(
  '/:complaintId',
  handle(async (req, res) => {
    const { complaintId } = complaintIdParamSchema.parse(req.params);
    const complaint = await service.getComplaint(
      deps(req),
      getAuthUser(req).id,
      complaintId,
      hasOpsRole(req),
    );

    res.status(200).json({ complaint });
  }),
);

/* -------------------------------------------------------------------------- */
/* Mounted under /api/v1/bookings/:bookingId/complaints                       */
/* -------------------------------------------------------------------------- */

export const bookingComplaintRouter = Router({ mergeParams: true });

bookingComplaintRouter.use(authenticate);

/**
 * Either party, from ARRIVED onwards.
 *
 * A `safety` complaint from a customer suspends the technician **before this
 * responds** — see the note in the service.
 */
bookingComplaintRouter.post(
  '/',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = raiseComplaintSchema.parse(req.body);
    const complaint = await service.raiseComplaint(
      deps(req),
      getAuthUser(req).id,
      bookingId,
      input,
    );

    res.status(201).json({ complaint, message: req.t('complaints.raised') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Ops queue                                                                  */
/* -------------------------------------------------------------------------- */

export const opsRouter = Router();

opsRouter.use(authenticate, requireRoles('ops', 'admin'));

/** Oldest first — a newest-first queue is one where the oldest is never read. */
opsRouter.get(
  '/',
  handle(async (req, res) => {
    const query = complaintQueueQuerySchema.parse(req.query);
    res.status(200).json(await service.listComplaintQueue(deps(req), query));
  }),
);

opsRouter.post(
  '/:complaintId/take-up',
  handle(async (req, res) => {
    const { complaintId } = complaintIdParamSchema.parse(req.params);
    const complaint = await service.decideComplaint(
      opsDeps(req, {
        action: AUDIT_ACTIONS.complaintTakeUp,
        targetType: 'complaint',
        targetId: complaintId,
        payload: {},
      }),
      getAuthUser(req).id,
      complaintId,
      { event: 'take_up' },
    );

    res.status(200).json({ complaint });
  }),
);

/**
 * Upheld. The severity is what the trust engine acts on, so it is mandatory —
 * `severe` suspends.
 */
opsRouter.post(
  '/:complaintId/resolve',
  handle(async (req, res) => {
    const { complaintId } = complaintIdParamSchema.parse(req.params);
    const input = resolveComplaintSchema.parse(req.body);

    const complaint = await service.decideComplaint(
      opsDeps(req, {
        action: AUDIT_ACTIONS.complaintResolve,
        targetType: 'complaint',
        targetId: complaintId,
        // Severity is the substance: it is what the trust engine acts on, and
        // `severe` suspends somebody.
        payload: { severity: input.severity, note: input.note },
      }),
      getAuthUser(req).id,
      complaintId,
      { event: 'resolve', note: input.note, severity: input.severity },
    );

    res.status(200).json({ complaint, message: req.t('complaints.resolved') });
  }),
);

/** Not upheld. Counts for nothing against anybody — deliberately no severity. */
opsRouter.post(
  '/:complaintId/dismiss',
  handle(async (req, res) => {
    const { complaintId } = complaintIdParamSchema.parse(req.params);
    const input = dismissComplaintSchema.parse(req.body);

    const complaint = await service.decideComplaint(
      opsDeps(req, {
        action: AUDIT_ACTIONS.complaintDismiss,
        targetType: 'complaint',
        targetId: complaintId,
        payload: { note: input.note },
      }),
      getAuthUser(req).id,
      complaintId,
      { event: 'dismiss', note: input.note },
    );

    res.status(200).json({ complaint, message: req.t('complaints.dismissed') });
  }),
);
