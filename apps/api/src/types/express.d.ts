import type { AppLogger } from '../core/logger';
import type { Locale, Translator } from '../core/i18n';

/**
 * Populated by the core middleware stack (request-id, locale) before any route
 * runs. Declared non-optional because every mounted route sits behind them.
 */
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: AppLogger;
      locale: Locale;
      t: Translator;
    }
  }
}

export {};
