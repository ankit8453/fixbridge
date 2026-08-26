import { z } from 'zod';
import { normalizePhone } from '../auth/phone';
import type { VerificationLevel } from './state-machine';

/* -------------------------------------------------------------------------- */
/* Identity numbers — masked, never raw                                       */
/* -------------------------------------------------------------------------- */

export const ID_TYPES = ['aadhaar', 'pan', 'dl', 'voter'] as const;
export type IdType = (typeof ID_TYPES)[number];

/**
 * We accept **only the last four digits** of an identity number, never the whole
 * one. Not "we mask it on the way in" — the full number is never sent, so it
 * cannot be logged by a request logger, captured by an error reporter, or found
 * in a database backup. Aadhaar in particular must never exist in our systems.
 *
 * The document image may of course show the number; that lives in private object
 * storage behind short-lived signed URLs and is never parsed.
 */
export const idLast4Field = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'must be exactly the last 4 digits of the ID');

/**
 * Rejects anything long enough to be a real identity number.
 *
 * A caller sending a full Aadhaar into a field meant for four digits is a
 * mistake worth failing loudly, not silently truncating — truncation would put
 * the whole number through our validation stack first.
 *
 * Only digits-and-separators count. Stripping *all* non-digits would flag a
 * UUID, which is how this first went wrong: `11111111-1111-4111-…` is a
 * perfectly good document id and not an identity number at all.
 */
export function looksLikeFullIdNumber(value: string): boolean {
  return /^\d{8,}$/.test(value.replace(/[\s-]/g, ''));
}

/**
 * Keys whose values are legitimately long digit strings and must not be scanned:
 * document ids (UUIDs), and phone numbers, which are validated elsewhere.
 */
export function isIdentityScanExempt(key: string): boolean {
  return /(Id|Ids)$/.test(key) || key === 'phone' || key === 'references';
}

/* -------------------------------------------------------------------------- */
/* References                                                                 */
/* -------------------------------------------------------------------------- */

export const REFERENCE_RELATIONSHIPS = [
  'past_employer',
  'shop_owner',
  'senior_technician',
  'other',
] as const;
export type ReferenceRelationship = (typeof REFERENCE_RELATIONSHIPS)[number];

/**
 * References are no longer collected — the level that asked for them was
 * removed, because requiring two contactable referees assumed every technician
 * has them.
 *
 * These shapes stay because the append-only log does not: cases submitted
 * before the change still hold reference phone numbers, and
 * `redactPayloadForProvider` below must keep masking them when that history is
 * read back. Deleting this would leave a third party's number readable in an
 * old payload.
 */
const referencePhone = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);

    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: 'must be a valid Indian mobile number' });
      return z.NEVER;
    }

    return normalized;
  });

export const referenceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: referencePhone,
  relationship: z.enum(REFERENCE_RELATIONSHIPS),
});

export type ReferenceInput = z.infer<typeof referenceSchema>;

/* -------------------------------------------------------------------------- */
/* Per-level submission payloads                                              */
/* -------------------------------------------------------------------------- */

/** Level 0 — identity. An ID document, a selfie, and the last four digits. */
export const level0Schema = z
  .object({
    idType: z.enum(ID_TYPES),
    idLast4: idLast4Field,
    idProofDocumentId: z.string().uuid(),
    selfieDocumentId: z.string().uuid(),
  })
  .strict();

/** Level 1 — background. Consent is the submission; ops or an adapter do the check. */
export const level1Schema = z
  .object({
    consent: z.literal(true, { message: 'background checks require explicit consent' }),
  })
  .strict();

/**
 * Level 2 — skill. Three routes to the same claim, and at least one must be
 * taken: a certificate, a trade test, or a field audit.
 */
export const level2Schema = z
  .object({
    certificateDocumentId: z.string().uuid().optional(),
    tradeTest: z.boolean().optional(),
    fieldAudit: z.boolean().optional(),
    notes: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const paths = [
      value.certificateDocumentId !== undefined,
      value.tradeTest === true,
      value.fieldAudit === true,
    ].filter(Boolean).length;

    if (paths === 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          'provide a certificate document, or request a trade test, or request a field audit',
      });
    }

    // A human has to arrange and judge these, so they need to know what for.
    if ((value.tradeTest === true || value.fieldAudit === true) && !value.notes) {
      ctx.addIssue({
        code: 'custom',
        path: ['notes'],
        message: 'notes are required when requesting a trade test or field audit',
      });
    }
  });

export const LEVEL_SCHEMAS = {
  0: level0Schema,
  1: level1Schema,
  2: level2Schema,
} as const;

export type Level0Payload = z.infer<typeof level0Schema>;
export type Level1Payload = z.infer<typeof level1Schema>;
export type Level2Payload = z.infer<typeof level2Schema>;

export type LevelPayload = Level0Payload | Level1Payload | Level2Payload;

export function schemaForLevel(
  level: VerificationLevel,
): (typeof LEVEL_SCHEMAS)[VerificationLevel] {
  return LEVEL_SCHEMAS[level];
}

/** Document ids a level's payload depends on — each must exist and be uploaded. */
export function requiredDocumentIds(level: VerificationLevel, payload: LevelPayload): string[] {
  if (level === 0) {
    const p = payload as Level0Payload;
    return [p.idProofDocumentId, p.selfieDocumentId];
  }

  if (level === 2) {
    const p = payload as Level2Payload;
    return p.certificateDocumentId ? [p.certificateDocumentId] : [];
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/* Provider-facing redaction                                                  */
/* -------------------------------------------------------------------------- */

/** `+919876543210` → `+9198765*****`, matching how phones are masked elsewhere. */
function maskReferencePhone(phone: string): string {
  const prefix = '+91';
  if (!phone.startsWith(prefix)) return '*'.repeat(Math.max(4, phone.length));

  const national = phone.slice(prefix.length);
  return `${prefix}${national.slice(0, 5)}${'*'.repeat(Math.max(0, national.length - 5))}`;
}

/**
 * Strips a stored payload down to what the provider themselves may see.
 *
 * Reference phone numbers are kept in full for ops — they have to ring them —
 * but masked on the way back to the provider, so the log of what was submitted
 * cannot be used to re-read a third party's number.
 */
export function redactPayloadForProvider(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;

  const record = { ...(payload as Record<string, unknown>) };

  if (Array.isArray(record.references)) {
    record.references = record.references.map((reference) => {
      if (reference === null || typeof reference !== 'object') return reference;

      const entry = reference as Record<string, unknown>;
      return {
        ...entry,
        phone: typeof entry.phone === 'string' ? maskReferencePhone(entry.phone) : entry.phone,
      };
    });
  }

  return record;
}
