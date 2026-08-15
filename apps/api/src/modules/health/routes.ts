import { Router } from 'express';
import type { HealthResponse } from '@fixbridge/shared';
import { getContext } from '../../core/context';
import { buildHealthReport } from './service';

export const router = Router();

/** `GET /health` — 200 when both dependencies answer, 503 when either does not. */
router.get('/', (req, res, next) => {
  void (async () => {
    try {
      const report = await buildHealthReport(getContext(req));

      const body: HealthResponse = {
        ...report,
        message: req.t(report.status === 'ok' ? 'health.ok' : 'health.degraded'),
      };

      res.status(report.status === 'ok' ? 200 : 503).json(body);
    } catch (error) {
      next(error);
    }
  })();
});
