import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AppLogger } from '../logger';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Conservative charset — an inbound id must never be able to poison logs or headers. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function isUsable(value: string | undefined): value is string {
  return value !== undefined && SAFE_REQUEST_ID.test(value);
}

/**
 * Accept a caller-supplied `X-Request-Id` (so a trace survives across services)
 * or mint one, echo it back, and bind a child logger carrying it to the request.
 */
export function createRequestIdMiddleware(logger: AppLogger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = isUsable(incoming) ? incoming : randomUUID();

    req.requestId = requestId;
    req.log = logger.child({ requestId });
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  };
}
