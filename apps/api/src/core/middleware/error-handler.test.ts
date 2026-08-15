import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors';
import { createTranslator, type Locale } from '../i18n';
import { createErrorHandler } from './error-handler';
import { notFoundHandler } from './not-found';

const TEST_REQUEST_ID = 'test-request-id';

const bodySchema = z.object({
  phone: z.string().min(10),
  cityId: z.number().int(),
});

/** Minimal stand-in for the core middleware stack the handler expects. */
const fakeContextMiddleware =
  (locale: Locale): RequestHandler =>
  (req, _res, next) => {
    req.requestId = TEST_REQUEST_ID;
    req.locale = locale;
    req.t = createTranslator(locale);
    next();
  };

function buildApp(options: { includeStack: boolean; locale?: Locale }): Express {
  const app = express();
  app.use(express.json());
  app.use(fakeContextMiddleware(options.locale ?? 'en'));

  app.get('/app-error', () => {
    throw AppError.notFound('Provider 42 does not exist');
  });

  app.get('/app-error-no-key', () => {
    throw new AppError(409, 'SLOT_TAKEN', 'That slot was just booked', {
      details: { slotId: 'slot-1' },
    });
  });

  app.post('/validated', (req) => {
    bodySchema.parse(req.body);
  });

  app.get('/boom', () => {
    throw new Error('database on fire');
  });

  app.get('/async-boom', (_req, _res, next) => {
    next(new Error('async failure'));
  });

  app.use(notFoundHandler);
  app.use(createErrorHandler({ includeStack: options.includeStack }));

  return app;
}

describe('error handler', () => {
  describe('AppError', () => {
    it('uses the error status, code and localised message', async () => {
      const response = await request(buildApp({ includeStack: false })).get('/app-error');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toBe('We could not find what you were looking for.');
      expect(response.body.error.requestId).toBe(TEST_REQUEST_ID);
    });

    it('localises the message per request locale', async () => {
      const response = await request(buildApp({ includeStack: false, locale: 'hi' })).get(
        '/app-error',
      );

      expect(response.body.error.message).toBe('आप जो ढूँढ रहे हैं, वह हमें नहीं मिला।');
    });

    it('falls back to the developer message when the error carries no i18n key', async () => {
      const response = await request(buildApp({ includeStack: false })).get('/app-error-no-key');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SLOT_TAKEN');
      expect(response.body.error.message).toBe('That slot was just booked');
      expect(response.body.error.details).toEqual({ slotId: 'slot-1' });
    });
  });

  describe('ZodError', () => {
    it('becomes a 400 with per-field details', async () => {
      const response = await request(buildApp({ includeStack: false }))
        .post('/validated')
        .send({ phone: '123', cityId: 'not-a-number' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Some of the details you sent are not valid.');

      const fields = (response.body.error.details as { field: string }[]).map((d) => d.field);
      expect(fields).toContain('phone');
      expect(fields).toContain('cityId');

      for (const detail of response.body.error.details as Record<string, unknown>[]) {
        expect(typeof detail.message).toBe('string');
        expect(typeof detail.code).toBe('string');
      }
    });
  });

  describe('unknown errors', () => {
    it('becomes a generic 500 that leaks nothing', async () => {
      const response = await request(buildApp({ includeStack: false })).get('/boom');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(response.body.error.message).toBe(
        'Something went wrong at our end. Please try again.',
      );
      expect(response.body.error.requestId).toBe(TEST_REQUEST_ID);
      expect(response.body.error.stack).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('database on fire');
    });

    it('includes the stack only when explicitly enabled', async () => {
      const response = await request(buildApp({ includeStack: true })).get('/boom');

      expect(response.status).toBe(500);
      expect(response.body.error.stack).toContain('database on fire');
    });

    it('handles errors passed to next()', async () => {
      const response = await request(buildApp({ includeStack: false })).get('/async-boom');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('unmatched routes', () => {
    it('produce a localised 404 through the same envelope', async () => {
      const response = await request(buildApp({ includeStack: false })).get('/nope');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.details).toEqual({ method: 'GET', path: '/nope' });
      expect(response.body.error.requestId).toBe(TEST_REQUEST_ID);
    });
  });
});
