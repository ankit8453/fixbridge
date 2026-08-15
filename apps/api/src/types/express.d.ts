import type { AuthenticatedUser } from '@fixbridge/shared';
import type { AppLogger } from '../core/logger';
import type { Locale, Translator } from '../core/i18n';

/**
 * Populated by the core middleware stack (request-id, locale) before any route
 * runs. Declared non-optional because every mounted route sits behind them.
 *
 * `user` is the exception: it is optional because it only exists on routes that
 * mount `authenticate`. Read it with `getAuthUser(req)` rather than asserting.
 */
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: AppLogger;
      locale: Locale;
      t: Translator;
      user?: AuthenticatedUser;
    }
  }
}

export {};
