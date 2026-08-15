import type { RequestHandler } from 'express';
import { AppError } from '../errors';

/** Anything that reached the end of the stack is a 404, funnelled through the error handler. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError(404, 'NOT_FOUND', `No route matches ${req.method} ${req.originalUrl}`, {
      messageKey: 'errors.notFound',
      details: { method: req.method, path: req.originalUrl },
    }),
  );
};
