import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../core/config';
import {
  OTP_LENGTH,
  generateOtp,
  hashOtp,
  isFixedOtpCandidate,
  matchesFixedOtp,
  otpKeys,
  verifyOtpHash,
} from './otp';

const SECRET = 'unit-test-secret-value-at-least-32-characters';
const PHONE = '+919876543210';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    AUTH_FIXED_OTP: '000000',
    AUTH_FIXED_OTP_PHONE_PREFIX: '+9199999',
    ...overrides,
  } as AppConfig;
}

describe('generateOtp', () => {
  it('always produces exactly six digits', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('zero-pads small values rather than shortening them', () => {
    const codes = Array.from({ length: 2000 }, () => generateOtp());
    expect(codes.every((code) => code.length === OTP_LENGTH)).toBe(true);
  });

  it('is not obviously constant', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(100);
  });
});

describe('hashOtp', () => {
  it('is deterministic for the same inputs', () => {
    expect(hashOtp(SECRET, PHONE, '123456')).toBe(hashOtp(SECRET, PHONE, '123456'));
  });

  it('produces a 64-character hex digest', () => {
    expect(hashOtp(SECRET, PHONE, '123456')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never contains the OTP itself', () => {
    expect(hashOtp(SECRET, PHONE, '123456')).not.toContain('123456');
  });

  it('is salted by phone — the same OTP hashes differently per number', () => {
    expect(hashOtp(SECRET, '+919876543210', '123456')).not.toBe(
      hashOtp(SECRET, '+919876543211', '123456'),
    );
  });

  it('depends on the secret, so a leaked Redis dump is not enough to forge one', () => {
    expect(hashOtp(SECRET, PHONE, '123456')).not.toBe(
      hashOtp('a-completely-different-secret-value-32chars', PHONE, '123456'),
    );
  });

  it('changes for a different OTP', () => {
    expect(hashOtp(SECRET, PHONE, '123456')).not.toBe(hashOtp(SECRET, PHONE, '123457'));
  });
});

describe('verifyOtpHash', () => {
  it('accepts a matching digest', () => {
    const hash = hashOtp(SECRET, PHONE, '654321');
    expect(verifyOtpHash(hash, hashOtp(SECRET, PHONE, '654321'))).toBe(true);
  });

  it('rejects a different digest', () => {
    const hash = hashOtp(SECRET, PHONE, '654321');
    expect(verifyOtpHash(hash, hashOtp(SECRET, PHONE, '654322'))).toBe(false);
  });

  it('rejects mismatched lengths without throwing', () => {
    expect(verifyOtpHash(hashOtp(SECRET, PHONE, '111111'), 'abcd')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(verifyOtpHash('', '')).toBe(false);
    expect(verifyOtpHash('', hashOtp(SECRET, PHONE, '111111'))).toBe(false);
  });
});

describe('fixed OTP escape hatch', () => {
  it('applies to a matching prefix outside production', () => {
    expect(isFixedOtpCandidate(config(), '+919999900001')).toBe(true);
    expect(matchesFixedOtp(config(), '+919999900001', '000000')).toBe(true);
  });

  it('does not apply to a normal phone number', () => {
    expect(isFixedOtpCandidate(config(), '+919876543210')).toBe(false);
    expect(matchesFixedOtp(config(), '+919876543210', '000000')).toBe(false);
  });

  it('rejects a different code even on a matching prefix', () => {
    expect(matchesFixedOtp(config(), '+919999900001', '111111')).toBe(false);
  });

  it('is inert when unset', () => {
    const withoutFixed = config({ AUTH_FIXED_OTP: undefined });
    expect(isFixedOtpCandidate(withoutFixed, '+919999900001')).toBe(false);
    expect(matchesFixedOtp(withoutFixed, '+919999900001', '000000')).toBe(false);
  });

  it('is inert in production even if a config somehow carried it', () => {
    const production = config({ NODE_ENV: 'production' });
    expect(isFixedOtpCandidate(production, '+919999900001')).toBe(false);
    expect(matchesFixedOtp(production, '+919999900001', '000000')).toBe(false);
  });
});

describe('otpKeys', () => {
  it('namespaces every key under auth:otp and carries no brand name', () => {
    const keys = [
      otpKeys.code(PHONE),
      otpKeys.attempts(PHONE),
      otpKeys.ratePhone(PHONE),
      otpKeys.rateIp('127.0.0.1'),
    ];

    for (const key of keys) {
      expect(key.startsWith('auth:otp:')).toBe(true);
    }

    expect(new Set(keys).size).toBe(keys.length);
  });
});
