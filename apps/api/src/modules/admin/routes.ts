import { Router, type Request, type RequestHandler } from 'express';
import { AUDIT_ACTIONS, auditActor, type AuditEntry } from '../../core/audit';
import { getContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import * as auth from '../auth/service';
import { platformPosition } from '../payments/ledger';
import * as repo from './repository';
import * as service from './service';
import {
  approveEntrySchema,
  blockUserSchema,
  bookingIdParamSchema,
  cityIdParamSchema,
  deliveryIdParamSchema,
  discardSchema,
  journalIdParamSchema,
  listAuditQuerySchema,
  listBatchesQuerySchema,
  listBookingsQuerySchema,
  listJournalsQuerySchema,
  listParkedQuerySchema,
  listProvidersQuerySchema,
  listUsersQuerySchema,
  opsCancelSchema,
  otpUnlockSchema,
  outboxIdParamSchema,
  providerIdParamSchema,
  updateCitySchema,
  userIdParamSchema,
  webhookIdParamSchema,
} from './types';

/**
 * `/api/v1/admin` — the ops console's API.
 *
 * Two rules hold across the whole router and both are enforced by tests:
 *
 *   **Nobody but ops gets in.** One `requireRoles` at the top rather than per
 *   route, so a new endpoint cannot be added un-guarded by forgetting a line.
 *
 *   **Every mutation is audited.** `AUDITED_ADMIN_ROUTES` in `core/audit.ts` is
 *   compared against this router's real Express stack in both directions, so an
 *   un-audited mutation fails CI and a stale registry entry does too.
 */

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.AdminDeps => ({ context: getContext(req) });

const authDeps = (req: Request, entry: AuditEntry): auth.AuthDeps => {
  const context = getContext(req);

  return {
    context,
    transport: context.otpTransport,
    audit: { actor: auditActor(req), entry },
  };
};

export const router = Router();

router.use(authenticate, requireRoles('ops', 'admin'));

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

/** Everything the "what needs my attention" wall shows, in one request. */
router.get(
  '/summary',
  handle(async (req, res) => {
    res.status(200).json(await service.getSummary(deps(req)));
  }),
);

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  '/users',
  handle(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    const { rows, total } = await repo.listUsers(getContext(req).prisma, query);

    res.status(200).json({
      users: rows.map((row) => ({
        ...row,
        roles: row.roles.map((entry) => entry.role),
        bookingCount: row._count.bookings,
        _count: undefined,
      })),
      page: query.page,
      pageSize: query.page_size,
      total,
    });
  }),
);

router.get(
  '/users/:userId',
  handle(async (req, res) => {
    const { userId } = userIdParamSchema.parse(req.params);
    const user = await repo.findUserDetail(getContext(req).prisma, userId);

    // Thrown, not hand-rolled: the error middleware owns the one envelope every
    // endpoint in this API returns, request id included.
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', `No user ${userId}`);

    res.status(200).json({ user });
  }),
);

/**
 * Blocking cuts somebody off **now**, not at token expiry.
 *
 * The reason is mandatory because this is the most severe thing ops can do to an
 * account, and "we blocked them" with no note is not something anybody can
 * defend three months later.
 */
router.post(
  '/users/:userId/block',
  handle(async (req, res) => {
    const { userId } = userIdParamSchema.parse(req.params);
    const input = blockUserSchema.parse(req.body);

    const user = await auth.blockUser(
      authDeps(req, {
        action: AUDIT_ACTIONS.userBlock,
        targetType: 'user',
        targetId: userId,
        payload: { reason: input.reason },
      }),
      userId,
    );

    res.status(200).json({ user });
  }),
);

router.post(
  '/users/:userId/unblock',
  handle(async (req, res) => {
    const { userId } = userIdParamSchema.parse(req.params);
    const input = blockUserSchema.parse(req.body);

    const user = await auth.unblockUser(
      authDeps(req, {
        action: AUDIT_ACTIONS.userUnblock,
        targetType: 'user',
        targetId: userId,
        payload: { reason: input.reason },
      }),
      userId,
    );

    res.status(200).json({ user });
  }),
);

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

router.get(
  '/providers',
  handle(async (req, res) => {
    const query = listProvidersQuerySchema.parse(req.query);
    const { rows, total } = await repo.listProviders(getContext(req).prisma, query, new Date());

    res.status(200).json({ providers: rows, page: query.page, pageSize: query.page_size, total });
  }),
);

/** The provider page: every reason they might be invisible, answered at once. */
router.get(
  '/providers/:providerId',
  handle(async (req, res) => {
    const { providerId } = providerIdParamSchema.parse(req.params);
    res.status(200).json(await service.getProviderAggregate(deps(req), providerId));
  }),
);

router.post(
  '/providers/:providerId/approve-entry',
  handle(async (req, res) => {
    const { providerId } = providerIdParamSchema.parse(req.params);
    const input = approveEntrySchema.parse(req.body);

    res
      .status(200)
      .json(await service.approveEntry(deps(req), auditActor(req), providerId, input.note));
  }),
);

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

router.get(
  '/bookings',
  handle(async (req, res) => {
    const query = listBookingsQuerySchema.parse(req.query);
    const { rows, total } = await repo.listBookings(getContext(req).prisma, query);

    res.status(200).json({ bookings: rows, page: query.page, pageSize: query.page_size, total });
  }),
);

/** The dispute screen's data: events, quotes, money, and what each side was told. */
router.get(
  '/bookings/:bookingId/timeline',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    res.status(200).json(await service.getBookingTimeline(deps(req), bookingId));
  }),
);

router.post(
  '/bookings/:bookingId/otp-unlock',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = otpUnlockSchema.parse(req.body);

    res
      .status(200)
      .json(await service.unlockBookingOtp(deps(req), auditActor(req), bookingId, input));
  }),
);

/**
 * Ops cancelling on somebody's behalf. Rare, and it follows the same state
 * machine rules a customer would — an ops button that could cancel a job already
 * in progress would be a way to lose money quietly.
 */
router.post(
  '/bookings/:bookingId/cancel',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = opsCancelSchema.parse(req.body);

    res
      .status(200)
      .json(await service.opsCancelBooking(deps(req), auditActor(req), bookingId, input.reason));
  }),
);

/* -------------------------------------------------------------------------- */
/* Money — read-only views (the mutations live on the payments ops router)     */
/* -------------------------------------------------------------------------- */

router.get(
  '/ledger/journals',
  handle(async (req, res) => {
    const query = listJournalsQuerySchema.parse(req.query);
    const { rows, total } = await repo.listJournals(getContext(req).prisma, query);

    res.status(200).json({ journals: rows, page: query.page, pageSize: query.page_size, total });
  }),
);

/** A journal and its entries, which always balance — see docs/money.md. */
router.get(
  '/ledger/journals/:journalId',
  handle(async (req, res) => {
    const { journalId } = journalIdParamSchema.parse(req.params);
    const journal = await repo.findJournal(getContext(req).prisma, journalId);

    if (!journal) throw new AppError(404, 'JOURNAL_NOT_FOUND', `No journal ${journalId}`);

    res.status(200).json({ journal });
  }),
);

router.get(
  '/ledger/position',
  handle(async (req, res) => {
    res.status(200).json({ position: await platformPosition(getContext(req).prisma) });
  }),
);

/* -------------------------------------------------------------------------- */
/* Parked queues                                                              */
/* -------------------------------------------------------------------------- */

router.get(
  '/queues/outbox',
  handle(async (req, res) => {
    const query = listParkedQuerySchema.parse(req.query);
    const context = getContext(req);

    const { rows, total } = await repo.listParkedOutbox(
      context.prisma,
      context.config.OUTBOX_MAX_ATTEMPTS,
      query.page,
      query.page_size,
    );

    res.status(200).json({ events: rows, page: query.page, pageSize: query.page_size, total });
  }),
);

router.post(
  '/queues/outbox/:outboxId/retry',
  handle(async (req, res) => {
    const { outboxId } = outboxIdParamSchema.parse(req.params);
    res.status(200).json(await service.retryOutbox(deps(req), auditActor(req), outboxId));
  }),
);

router.post(
  '/queues/outbox/:outboxId/discard',
  handle(async (req, res) => {
    const { outboxId } = outboxIdParamSchema.parse(req.params);
    const input = discardSchema.parse(req.body);

    res
      .status(200)
      .json(await service.discardOutbox(deps(req), auditActor(req), outboxId, input.reason));
  }),
);

router.get(
  '/queues/webhooks',
  handle(async (req, res) => {
    const query = listParkedQuerySchema.parse(req.query);
    const { rows, total } = await repo.listFailedWebhooks(
      getContext(req).prisma,
      query.page,
      query.page_size,
    );

    res.status(200).json({ webhooks: rows, page: query.page, pageSize: query.page_size, total });
  }),
);

router.post(
  '/queues/webhooks/:webhookId/reprocess',
  handle(async (req, res) => {
    const { webhookId } = webhookIdParamSchema.parse(req.params);
    res.status(200).json(await service.reprocessWebhook(deps(req), auditActor(req), webhookId));
  }),
);

router.post(
  '/queues/webhooks/:webhookId/discard',
  handle(async (req, res) => {
    const { webhookId } = webhookIdParamSchema.parse(req.params);
    const input = discardSchema.parse(req.body);

    res
      .status(200)
      .json(await service.discardWebhook(deps(req), auditActor(req), webhookId, input.reason));
  }),
);

router.get(
  '/queues/deliveries',
  handle(async (req, res) => {
    const query = listParkedQuerySchema.parse(req.query);
    const context = getContext(req);

    const { rows, total } = await repo.listParkedDeliveries(
      context.prisma,
      context.config.NOTIFY_MAX_ATTEMPTS,
      query.page,
      query.page_size,
    );

    res.status(200).json({ deliveries: rows, page: query.page, pageSize: query.page_size, total });
  }),
);

router.post(
  '/queues/deliveries/:deliveryId/retry',
  handle(async (req, res) => {
    const { deliveryId } = deliveryIdParamSchema.parse(req.params);
    res.status(200).json(await service.retryDelivery(deps(req), auditActor(req), deliveryId));
  }),
);

router.post(
  '/queues/deliveries/:deliveryId/discard',
  handle(async (req, res) => {
    const { deliveryId } = deliveryIdParamSchema.parse(req.params);
    const input = discardSchema.parse(req.body);

    res
      .status(200)
      .json(await service.discardDelivery(deps(req), auditActor(req), deliveryId, input.reason));
  }),
);

/* -------------------------------------------------------------------------- */
/* Cities                                                                     */
/* -------------------------------------------------------------------------- */

router.get(
  '/cities',
  handle(async (req, res) => {
    const cities = await getContext(req).prisma.city.findMany({ orderBy: { id: 'asc' } });
    res.status(200).json({ cities });
  }),
);

/**
 * Admin only: this changes the rules everybody else operates inside.
 *
 * Turning entry approval on puts a human in the path of every technician signup
 * in a city. That is a policy decision about how the marketplace runs, not a
 * judgment call about one person, so it sits with the same role that holds the
 * money — see `ADMIN_ONLY_ROUTES`.
 */
router.patch(
  '/cities/:cityId',
  requireRoles('admin'),
  handle(async (req, res) => {
    const { cityId } = cityIdParamSchema.parse(req.params);
    const input = updateCitySchema.parse(req.body);

    const city = await service.updateCitySettings(deps(req), auditActor(req), cityId, input);
    res.status(200).json({ city });
  }),
);

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Read-only, and there is no endpoint that writes one directly.
 *
 * An audit row only ever comes into existence alongside the thing it describes.
 * A "create audit entry" endpoint would make the whole table deniable.
 *
 * ## Ops sees their own work; admin sees everyone's
 *
 * The audit log is a supervision tool, and a supervision tool everybody can read
 * about everybody is a different thing — it turns into a way for colleagues to
 * check up on each other, which is not what it is for. An ops user can review
 * and account for their own decisions, which is the legitimate need; reviewing
 * somebody else's is the supervisor's job.
 *
 * Forced server-side rather than filtered in the console, because a filter the
 * client applies is not a permission.
 */
router.get(
  '/audit-logs',
  handle(async (req, res) => {
    const query = listAuditQuerySchema.parse(req.query);
    const viewer = getAuthUser(req);
    const isAdmin = viewer.roles.includes('admin');

    const { rows, total } = await repo.listAuditLogs(getContext(req).prisma, {
      ...query,
      ...(isAdmin ? {} : { actorUserId: viewer.id }),
    });

    res.status(200).json({
      entries: rows,
      page: query.page,
      pageSize: query.page_size,
      total,
      /** So the console can say "your actions" rather than implying it is everything. */
      scope: isAdmin ? 'all' : 'own',
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Payout batches — list (the lifecycle mutations live with payments)         */
/* -------------------------------------------------------------------------- */

router.get(
  '/payout-batches',
  handle(async (req, res) => {
    const query = listBatchesQuerySchema.parse(req.query);
    const { rows, total } = await repo.listPayoutBatches(
      getContext(req).prisma,
      query.page,
      query.page_size,
    );

    res.status(200).json({ batches: rows, page: query.page, pageSize: query.page_size, total });
  }),
);
