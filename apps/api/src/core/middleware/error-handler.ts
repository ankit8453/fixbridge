import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody, ApiFieldError } from '@fixbridge/shared';
import { DEFAULT_LOCALE, createTranslator, type Translator } from '../i18n';
import { isAppError } from '../errors';
import type { AppLogger } from '../logger';

export interface ErrorHandlerOptions {
  /** Attach stack traces to 5xx responses. Must stay false in production. */
  includeStack: boolean;
  /** Used only when the request never reached the request-id middleware. */
  logger?: AppLogger;
}

function toFieldErrors(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * The single place an error becomes an HTTP response.
 *
 * - `ZodError`      → 400 with per-field details
 * - `AppError`      → its own status/code, message localised when it carries a key
 * - anything else   → 500 with a generic localised message; the real error is
 *                     logged, never sent, and no stack leaks in production.
 *
 * Every response carries the request id so a user-reported failure is greppable.
 */
export function createErrorHandler(options: ErrorHandlerOptions): ErrorRequestHandler {
  const fallbackTranslator: Translator = createTranslator(DEFAULT_LOCALE);

  return (err, req, res, next) => {
    // Headers already flushed — Express's default handler must close the socket.
    if (res.headersSent) {
      next(err);
      return;
    }

    const requestId = req.requestId ?? 'unknown';
    const t = req.t ?? fallbackTranslator;
    const log = req.log ?? options.logger;

    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = t('errors.internal');
    let details: unknown;

    if (err instanceof ZodError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = t('errors.validation');
      details = toFieldErrors(err);
    } else if (isAppError(err)) {
      statusCode = err.statusCode;
      code = err.code;
      message = err.messageKey ? t(err.messageKey) : err.message;
      details = err.details;

      // Headers the error itself implies: Retry-After, WWW-Authenticate, …
      for (const [name, value] of Object.entries(err.headers ?? {})) {
        res.setHeader(name, value);
      }
    }

    if (statusCode >= 500) {
      log?.error({ err, requestId, code }, 'request failed');
    } else {
      log?.warn({ err, requestId, code, statusCode }, 'request rejected');
    }

    const body: ApiErrorBody = { error: { code, message, requestId } };

    if (details !== undefined) {
      body.error.details = details;
    }

    if (options.includeStack && statusCode >= 500 && err instanceof Error && err.stack) {
      body.error.stack = err.stack;
    }

    res.status(statusCode).json(body);
  };
}
