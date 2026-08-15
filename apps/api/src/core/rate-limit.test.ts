import { describe, expect, it } from 'vitest';
import { evaluateRateLimit } from './rate-limit';

describe('evaluateRateLimit', () => {
  it('allows hits up to and including the limit', () => {
    expect(evaluateRateLimit(1, 3, 900, 900).allowed).toBe(true);
    expect(evaluateRateLimit(2, 3, 900, 900).allowed).toBe(true);
    expect(evaluateRateLimit(3, 3, 900, 900).allowed).toBe(true);
  });

  it('blocks the hit that exceeds the limit', () => {
    expect(evaluateRateLimit(4, 3, 900, 900).allowed).toBe(false);
  });

  it('stays blocked once past the limit', () => {
    expect(evaluateRateLimit(50, 3, 120, 900).allowed).toBe(false);
  });

  it('counts down the remaining allowance', () => {
    expect(evaluateRateLimit(1, 3, 900, 900).remaining).toBe(2);
    expect(evaluateRateLimit(3, 3, 900, 900).remaining).toBe(0);
  });

  it('never reports negative remaining', () => {
    expect(evaluateRateLimit(10, 3, 900, 900).remaining).toBe(0);
  });

  it('uses the live TTL as Retry-After', () => {
    expect(evaluateRateLimit(4, 3, 421, 900).retryAfterSeconds).toBe(421);
  });

  it('falls back to the full window when Redis reports no TTL', () => {
    expect(evaluateRateLimit(4, 3, -1, 900).retryAfterSeconds).toBe(900);
    expect(evaluateRateLimit(4, 3, -2, 900).retryAfterSeconds).toBe(900);
    expect(evaluateRateLimit(4, 3, 0, 900).retryAfterSeconds).toBe(900);
  });

  it('echoes the count and limit for logging', () => {
    const result = evaluateRateLimit(7, 5, 300, 900);

    expect(result.count).toBe(7);
    expect(result.limit).toBe(5);
  });

  it('handles a limit of one', () => {
    expect(evaluateRateLimit(1, 1, 900, 900).allowed).toBe(true);
    expect(evaluateRateLimit(2, 1, 900, 900).allowed).toBe(false);
  });
});
