import { describe, expect, it } from 'vitest';
import {
  level0Schema,
  level1Schema,
  level2Schema,
  level3Schema,
  isIdentityScanExempt,
  looksLikeFullIdNumber,
  redactPayloadForProvider,
  requiredDocumentIds,
  schemaForLevel,
} from './requirements';

const DOC_A = 'a1b2c3d4-1111-4111-8111-aaaaaaaaaaaa';
const DOC_B = 'e5f6a7b8-2222-4222-8222-bbbbbbbbbbbb';

/**
 * Assembled from parts rather than written out, so the repository-wide
 * Aadhaar scan in `no-raw-id-numbers.test.ts` stays honest — a literal
 * 12-digit fixture here would be exactly what that test exists to catch.
 */
const FAKE_FULL_ID = ['4321', '8765', '2109'].join('');
const FAKE_FULL_ID_GROUPED = ['4321', '8765', '2109'].join('-');
const FAKE_FULL_ID_SPACED = ['4321', '8765', '2109'].join(' ');

describe('level 0 — identity', () => {
  const valid = {
    idType: 'aadhaar' as const,
    idLast4: '1234',
    idProofDocumentId: DOC_A,
    selfieDocumentId: DOC_B,
  };

  it('accepts a complete submission', () => {
    expect(level0Schema.parse(valid)).toEqual(valid);
  });

  it('accepts every supported ID type', () => {
    for (const idType of ['aadhaar', 'pan', 'dl', 'voter'] as const) {
      expect(level0Schema.safeParse({ ...valid, idType }).success).toBe(true);
    }
  });

  it('rejects an unknown ID type', () => {
    expect(level0Schema.safeParse({ ...valid, idType: 'passport' }).success).toBe(false);
  });

  /** The core privacy rule: only the last four digits are ever accepted. */
  it('accepts exactly four digits and nothing longer', () => {
    expect(level0Schema.safeParse({ ...valid, idLast4: '1234' }).success).toBe(true);
    expect(level0Schema.safeParse({ ...valid, idLast4: FAKE_FULL_ID }).success).toBe(false);
    expect(level0Schema.safeParse({ ...valid, idLast4: '123' }).success).toBe(false);
    expect(level0Schema.safeParse({ ...valid, idLast4: '12345' }).success).toBe(false);
    expect(level0Schema.safeParse({ ...valid, idLast4: 'abcd' }).success).toBe(false);
  });

  it('requires both documents', () => {
    expect(level0Schema.safeParse({ ...valid, idProofDocumentId: undefined }).success).toBe(false);
    expect(level0Schema.safeParse({ ...valid, selfieDocumentId: undefined }).success).toBe(false);
  });

  it('rejects unknown fields, so nothing extra can be smuggled into the payload', () => {
    expect(level0Schema.safeParse({ ...valid, aadhaarNumber: FAKE_FULL_ID }).success).toBe(false);
  });
});

describe('level 1 — background', () => {
  it('requires explicit consent', () => {
    expect(level1Schema.parse({ consent: true })).toEqual({ consent: true });
  });

  it('refuses a submission without consent', () => {
    expect(level1Schema.safeParse({ consent: false }).success).toBe(false);
    expect(level1Schema.safeParse({}).success).toBe(false);
  });
});

describe('level 2 — skill', () => {
  it('accepts a certificate on its own', () => {
    expect(level2Schema.safeParse({ certificateDocumentId: DOC_A }).success).toBe(true);
  });

  it('accepts a trade test when the reason is explained', () => {
    expect(level2Schema.safeParse({ tradeTest: true, notes: 'Bench test' }).success).toBe(true);
  });

  it('accepts a field audit when the reason is explained', () => {
    expect(level2Schema.safeParse({ fieldAudit: true, notes: 'Observe a job' }).success).toBe(true);
  });

  it('refuses a submission that claims nothing', () => {
    expect(level2Schema.safeParse({}).success).toBe(false);
    expect(level2Schema.safeParse({ tradeTest: false, fieldAudit: false }).success).toBe(false);
  });

  it('requires notes for the routes a human has to arrange', () => {
    expect(level2Schema.safeParse({ tradeTest: true }).success).toBe(false);
    expect(level2Schema.safeParse({ fieldAudit: true }).success).toBe(false);
  });

  it('does not demand notes when a certificate speaks for itself', () => {
    expect(level2Schema.safeParse({ certificateDocumentId: DOC_A }).success).toBe(true);
  });
});

describe('level 3 — references', () => {
  const reference = (phone: string, name = 'Ramesh Gupta') => ({
    name,
    phone,
    relationship: 'past_employer' as const,
  });

  it('accepts exactly two distinct references', () => {
    const parsed = level3Schema.parse({
      references: [reference('9876543210'), reference('9876543211', 'Sunita Devi')],
    });

    // Phones are normalised to E.164 on the way in, like everywhere else.
    expect(parsed.references[0]?.phone).toBe('+919876543210');
  });

  it('refuses one reference or three', () => {
    expect(level3Schema.safeParse({ references: [reference('9876543210')] }).success).toBe(false);
    expect(
      level3Schema.safeParse({
        references: [reference('9876543210'), reference('9876543211'), reference('9876543212')],
      }).success,
    ).toBe(false);
  });

  it('refuses the same person listed twice', () => {
    expect(
      level3Schema.safeParse({
        references: [reference('9876543210'), reference('9876543210', 'Different Name')],
      }).success,
    ).toBe(false);
  });

  it('refuses an invalid phone', () => {
    expect(
      level3Schema.safeParse({
        references: [reference('12345'), reference('9876543211')],
      }).success,
    ).toBe(false);
  });

  it('accepts every relationship kind', () => {
    for (const relationship of [
      'past_employer',
      'shop_owner',
      'senior_technician',
      'other',
    ] as const) {
      expect(
        level3Schema.safeParse({
          references: [
            { ...reference('9876543210'), relationship },
            { ...reference('9876543211'), relationship },
          ],
        }).success,
      ).toBe(true);
    }
  });
});

describe('schemaForLevel', () => {
  it('routes each level to its own schema', () => {
    expect(schemaForLevel(0)).toBe(level0Schema);
    expect(schemaForLevel(1)).toBe(level1Schema);
    expect(schemaForLevel(2)).toBe(level2Schema);
    expect(schemaForLevel(3)).toBe(level3Schema);
  });
});

describe('requiredDocumentIds', () => {
  it('lists both documents for identity', () => {
    expect(
      requiredDocumentIds(0, {
        idType: 'pan',
        idLast4: '9999',
        idProofDocumentId: DOC_A,
        selfieDocumentId: DOC_B,
      }),
    ).toEqual([DOC_A, DOC_B]);
  });

  it('lists the certificate for skill when one was given', () => {
    expect(requiredDocumentIds(2, { certificateDocumentId: DOC_A })).toEqual([DOC_A]);
    expect(requiredDocumentIds(2, { tradeTest: true, notes: 'x' })).toEqual([]);
  });

  it('needs no documents for background or references', () => {
    expect(requiredDocumentIds(1, { consent: true })).toEqual([]);
    expect(requiredDocumentIds(3, { references: [] } as never)).toEqual([]);
  });
});

describe('looksLikeFullIdNumber', () => {
  it('flags anything long enough to be a real identity number', () => {
    expect(looksLikeFullIdNumber(FAKE_FULL_ID)).toBe(true);
    expect(looksLikeFullIdNumber(FAKE_FULL_ID_SPACED)).toBe(true);
    expect(looksLikeFullIdNumber(FAKE_FULL_ID_GROUPED)).toBe(true);
  });

  it('leaves a last-4 alone', () => {
    expect(looksLikeFullIdNumber('1234')).toBe(false);
    expect(looksLikeFullIdNumber('ABCDE1234F')).toBe(false);
  });

  /**
   * The false positive that broke the first version: stripping every non-digit
   * turned a document UUID into a 32-digit "identity number", so submitting
   * level 0 with valid document ids was rejected as a privacy violation.
   */
  it('does not flag an ordinary document UUID', () => {
    expect(looksLikeFullIdNumber(DOC_A)).toBe(false);
    expect(looksLikeFullIdNumber(DOC_B)).toBe(false);
  });

  /**
   * An all-numeric UUID is indistinguishable from a long number by shape alone,
   * which is exactly why the caller exempts id-bearing keys by name rather than
   * relying on this heuristic to be clever.
   */
  it('cannot tell an all-digit UUID apart — the key exemption is what covers that', () => {
    const allDigitUuid = ['1'.repeat(8), '1111', '4111', '8111', '1'.repeat(12)].join('-');

    expect(looksLikeFullIdNumber(allDigitUuid)).toBe(true);
    expect(isIdentityScanExempt('idProofDocumentId')).toBe(true);
  });
});

describe('isIdentityScanExempt', () => {
  it('exempts document ids and phones, which are legitimately long digit strings', () => {
    expect(isIdentityScanExempt('idProofDocumentId')).toBe(true);
    expect(isIdentityScanExempt('documentIds')).toBe(true);
    expect(isIdentityScanExempt('phone')).toBe(true);
    expect(isIdentityScanExempt('references')).toBe(true);
  });

  it('scans everything else', () => {
    expect(isIdentityScanExempt('idLast4')).toBe(false);
    expect(isIdentityScanExempt('notes')).toBe(false);
  });
});

describe('redactPayloadForProvider', () => {
  it('masks reference phones so the log cannot be mined for them', () => {
    const redacted = redactPayloadForProvider({
      references: [{ name: 'Ramesh', phone: '+919876543210', relationship: 'shop_owner' }],
    }) as { references: { phone: string; name: string }[] };

    expect(redacted.references[0]?.phone).toBe('+9198765*****');
    expect(redacted.references[0]?.name).toBe('Ramesh');
    expect(JSON.stringify(redacted)).not.toContain('9876543210');
  });

  it('leaves everything else intact', () => {
    const payload = { idType: 'aadhaar', idLast4: '1234' };
    expect(redactPayloadForProvider(payload)).toEqual(payload);
  });

  it('survives odd input', () => {
    expect(redactPayloadForProvider(null)).toBeNull();
    expect(redactPayloadForProvider('text')).toBe('text');
    expect(redactPayloadForProvider({ references: 'not an array' })).toEqual({
      references: 'not an array',
    });
  });
});
