import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config';
import { createCors } from './cors';

const config = {
  WEB_ORIGIN: 'https://www.fixbridge.me',
  ADMIN_ORIGIN: 'http://localhost:5173',
} as AppConfig;

function preflight(origin: string) {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
  } as unknown as Response;
  const next = vi.fn();

  createCors(config)({ method: 'OPTIONS', headers: { origin } } as Request, res, next);

  return { headers, res, next };
}

describe('cors', () => {
  it('allows every method the API actually routes, PUT included', () => {
    const { headers } = preflight('https://www.fixbridge.me');
    const methods = headers['Access-Control-Allow-Methods']?.split(',') ?? [];

    // PUT /providers/me/payout-details is called from the web partner app.
    expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']));
  });

  it('answers a preflight without passing it on', () => {
    const { res, next } = preflight('https://www.fixbridge.me');

    expect(res.status).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it('grants nothing to an origin that is not on the list', () => {
    const { headers } = preflight('https://www.fixbridge.me.attacker.net');

    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Methods']).toBeUndefined();
  });
});
