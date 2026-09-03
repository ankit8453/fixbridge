import { describe, expect, it } from 'vitest';
import { payoutDetailSchema, toPayoutDetailView } from './payout-details';

/**
 * This is the only field a technician can set that decides where money lands,
 * and a wrong-but-valid value pays a stranger with no undo. So the validation
 * is tested for what it *rejects*, not only for what it accepts.
 */

const bank = {
  method: 'bank' as const,
  accountNumber: '50100234567890',
  confirmAccountNumber: '50100234567890',
  ifsc: 'HDFC0001234',
  accountHolder: 'Ankit Pawar',
};

describe('payoutDetailSchema — bank', () => {
  it('accepts a real account and normalises what a passbook prints', () => {
    // Passbooks group the digits. Somebody copying what is in front of them
    // should not be told they are wrong.
    const parsed = payoutDetailSchema.parse({
      ...bank,
      accountNumber: '5010 0234 567890',
      confirmAccountNumber: '5010-0234-567890',
      ifsc: 'hdfc0001234',
    });

    expect(parsed).toMatchObject({
      method: 'bank',
      accountNumber: '50100234567890',
      ifsc: 'HDFC0001234',
    });
  });

  it('rejects an IFSC with a letter O where the zero belongs', () => {
    // The fifth character is always a zero. This is the commonest typo there
    // is, and the only one the format can catch on its own.
    expect(() => payoutDetailSchema.parse({ ...bank, ifsc: 'HDFCO001234' })).toThrow();
  });

  it('rejects account numbers that are too short or too long to be real', () => {
    expect(() => payoutDetailSchema.parse({ ...bank, accountNumber: '12345678' })).toThrow();
    expect(() =>
      payoutDetailSchema.parse({ ...bank, accountNumber: '1234567890123456789' }),
    ).toThrow();
  });

  it('refuses a bank record missing any of its three parts', () => {
    // A half-filled record is worse than none: it looks answered and cannot be
    // paid. The shape is what makes that unexpressible.
    for (const field of ['accountNumber', 'ifsc', 'accountHolder'] as const) {
      const partial: Record<string, unknown> = { ...bank };
      delete partial[field];
      expect(() => payoutDetailSchema.parse(partial)).toThrow();
    }
  });
});

describe('payoutDetailSchema — UPI', () => {
  it('accepts a handle and lowercases it', () => {
    expect(payoutDetailSchema.parse({ method: 'upi', upiId: 'Ankit@OkHdfcBank' })).toMatchObject({
      method: 'upi',
      upiId: 'ankit@okhdfcbank',
    });
  });

  it('rejects something that is not a handle at all', () => {
    for (const upiId of ['ankit', 'ankit@', '@okhdfcbank', 'ankit okhdfc@bank']) {
      expect(() => payoutDetailSchema.parse({ method: 'upi', upiId })).toThrow();
    }
  });

  it('does not accept bank fields smuggled into a UPI record', () => {
    // The discriminated union is what stops a stale account number riding along
    // when somebody switches method.
    const parsed = payoutDetailSchema.parse({
      method: 'upi',
      upiId: 'ankit@okhdfcbank',
      accountNumber: '50100234567890',
    });

    expect(parsed).not.toHaveProperty('accountNumber');
  });
});

describe('payoutDetailSchema — PAN', () => {
  it('accepts a valid PAN in any case', () => {
    expect(payoutDetailSchema.parse({ ...bank, pan: 'abcde1234f' })).toMatchObject({
      pan: 'ABCDE1234F',
    });
  });

  it('is optional — it is not needed until the TDS threshold is', () => {
    expect(payoutDetailSchema.parse(bank)).not.toHaveProperty('pan');
  });

  it('rejects a malformed PAN rather than storing something unfileable', () => {
    for (const pan of ['ABCD1234F', 'ABCDE12345', 'ABCDE1234FG', '1BCDE1234F']) {
      expect(() => payoutDetailSchema.parse({ ...bank, pan })).toThrow();
    }
  });
});

describe('toPayoutDetailView', () => {
  const updatedAt = new Date('2026-09-03T12:00:00.000Z');

  it('never returns the account number or the PAN in full', () => {
    const view = toPayoutDetailView({
      method: 'bank',
      accountNumber: '50100234567890',
      ifsc: 'HDFC0001234',
      accountHolder: 'Ankit Pawar',
      upiId: null,
      pan: 'ABCDE1234F',
      updatedAt,
    });

    expect(view.accountNumberMasked).toBe('••••••7890');
    expect(view.panMasked).toBe('ABCDE••••F');

    // The whole point, asserted directly: nothing in what leaves the server
    // contains either value.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('50100234567890');
    expect(serialised).not.toContain('ABCDE1234F');
  });

  it('shows the UPI id in full, because it is not a secret', () => {
    // A UPI handle is what you give somebody so they can pay you. Masking it
    // would hide the one thing the technician needs to check is right.
    const view = toPayoutDetailView({
      method: 'upi',
      accountNumber: null,
      ifsc: null,
      accountHolder: null,
      upiId: 'ankit@okhdfcbank',
      pan: null,
      updatedAt,
    });

    expect(view.upiId).toBe('ankit@okhdfcbank');
    expect(view.accountNumberMasked).toBeNull();
    expect(view.panMasked).toBeNull();
  });
});
