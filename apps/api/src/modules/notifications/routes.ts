import { Router, type Request, type RequestHandler } from 'express';
import { getContext } from '../../core/context';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import * as service from './service';
import { listNotificationsQuerySchema, notificationIdParamSchema } from './types';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.NotificationDeps => ({ context: getContext(req) });

export const router = Router();

/**
 * Every route here is scoped to the caller's own inbox.
 *
 * There is no "read somebody else's notifications" endpoint and there will not
 * be one: an inbox is a record of what a specific person was told, and ops
 * needing to answer "did they get the message" is a question about
 * `notification_deliveries`, which Phase 11 reads directly.
 */
router.use(authenticate);

/** GET /api/v1/notifications — newest first, paginated. */
router.get(
  '/',
  handle(async (req, res) => {
    const query = listNotificationsQuerySchema.parse(req.query);
    const context = getContext(req);

    const result = await service.listNotifications(deps(req), getAuthUser(req).id, {
      page: query.page,
      pageSize: query.page_size ?? context.config.NOTIFICATION_PAGE_SIZE,
      unreadOnly: query.unread_only,
    });

    res.status(200).json(result);
  }),
);

/** GET /api/v1/notifications/unread-count — the badge on the bell. */
router.get(
  '/unread-count',
  handle(async (req, res) => {
    const unread = await service.unreadCount(deps(req), getAuthUser(req).id);

    res.status(200).json({ unread });
  }),
);

router.post(
  '/read-all',
  handle(async (req, res) => {
    const marked = await service.markAllRead(deps(req), getAuthUser(req).id);

    res.status(200).json({ marked, unread: 0 });
  }),
);

router.post(
  '/:notificationId/read',
  handle(async (req, res) => {
    const { notificationId } = notificationIdParamSchema.parse(req.params);
    const userId = getAuthUser(req).id;

    /**
     * The result is deliberately the same whether the row was already read,
     * belongs to somebody else, or does not exist. Distinguishing them would
     * let anybody enumerate which notification ids are real, and "mark as read"
     * is idempotent by nature anyway.
     */
    await service.markRead(deps(req), userId, notificationId);
    const unread = await service.unreadCount(deps(req), userId);

    res.status(200).json({ id: notificationId, read: true, unread });
  }),
);
