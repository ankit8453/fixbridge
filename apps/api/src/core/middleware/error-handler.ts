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

/**
 * An error that already knows it is the caller's fault.
 *
 * Express's body parser (and several other middlewares) throw plain `Error`s
 * with a `status`/`statusCode` property already set — a malformed JSON body
 * arrives as a `SyntaxError` carrying `status: 400`. Honouring that is the
 * difference between "you sent bad JSON" and a 500 that blames the server for
 * something it did nothing wrong in.
 *
 * Restricted to 4xx deliberately: a middleware claiming a 5xx gets the normal
 * internal-error treatment, message and all, because that *is* our fault.
 */
function clientErrorStatus(value: unknown): number | null {
  if (!(value instanceof Error)) return null;

  const raw =
    (value as { status?: unknown }).status ?? (value as { statusCode?: unknown }).statusCode;

  return typeof raw === 'number' && raw >= 400 && raw < 500 ? raw : null;
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

    const clientStatus = clientErrorStatus(err);

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
    } else if (clientStatus !== null) {
      /**
       * A malformed request body is the client's mistake, not ours.
       *
       * `express.json()` throws a `SyntaxError` carrying `status: 400`, and
       * without this branch it fell through to the 500 default — so a caller
       * sending `{ broken json` was told "something went wrong at our end",
       * and could inflate the 5xx rate that alerting watches at will.
       */
      statusCode = clientStatus;
      code = 'BAD_REQUEST';
      message = t('errors.badRequest');
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
