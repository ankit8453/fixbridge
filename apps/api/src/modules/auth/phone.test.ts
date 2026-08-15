import { describe, expect, it } from 'vitest';
import { isValidPhone, maskPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('accepts a bare 10-digit mobile', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('accepts every leading-6-to-9 series', () => {
    expect(normalizePhone('6012345678')).toBe('+916012345678');
    expect(normalizePhone('7012345678')).toBe('+917012345678');
    expect(normalizePhone('8012345678')).toBe('+918012345678');
    expect(normalizePhone('9012345678')).toBe('+919012345678');
  });

  it('strips the domestic trunk prefix', () => {
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('accepts the country code with and without +', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('00919876543210')).toBe('+919876543210');
  });

  it('ignores spaces, hyphens, dots and brackets', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(+91) 98765.43210')).toBe('+919876543210');
    expect(normalizePhone('  9876543210  ')).toBe('+919876543210');
  });

  it('handles unicode dashes people paste from documents', () => {
    expect(normalizePhone('98765‑43210')).toBe('+919876543210');
    expect(normalizePhone('98765–43210')).toBe('+919876543210');
  });

  it('is idempotent on an already-normalised number', () => {
    const once = normalizePhone('9876543210');
    expect(once).not.toBeNull();
    expect(normalizePhone(once as string)).toBe(once);
  });

  it('rejects landline and invalid series', () => {
    expect(normalizePhone('1234567890')).toBeNull();
    expect(normalizePhone('5876543210')).toBeNull();
    expect(normalizePhone('0123456789')).toBeNull();
  });

  it('rejects wrong lengths', () => {
    expect(normalizePhone('987654321')).toBeNull();
    expect(normalizePhone('98765432101')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
  });

  it('rejects non-Indian country codes', () => {
    expect(normalizePhone('+14155552671')).toBeNull();
    expect(normalizePhone('+8619876543210')).toBeNull();
  });

  it('rejects anything containing letters or symbols', () => {
    expect(normalizePhone('98765abcde')).toBeNull();
    expect(normalizePhone('9876543210; DROP TABLE users')).toBeNull();
    expect(normalizePhone('+91+919876543210')).toBeNull();
  });

  it('survives a non-string input', () => {
    expect(normalizePhone(undefined as unknown as string)).toBeNull();
    expect(normalizePhone(null as unknown as string)).toBeNull();
    expect(normalizePhone(9876543210 as unknown as string)).toBeNull();
  });
});

describe('isValidPhone', () => {
  it('agrees with normalizePhone', () => {
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('1234567890')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('reveals only the first five national digits', () => {
    expect(maskPhone('+919876543210')).toBe('+9198765*****');
  });

  it('never leaks the last five digits', () => {
    expect(maskPhone('+919876543210')).not.toContain('43210');
  });

  it('masks entirely when the shape is unexpected', () => {
    const masked = maskPhone('+14155552671');
    expect(masked).toMatch(/^\*+$/);
    expect(masked).not.toContain('4155');
  });
});
