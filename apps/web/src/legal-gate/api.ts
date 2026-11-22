import { apiRequest } from '@/lib/api';

/**
 * `GET /legal/me` + `POST /legal/accept` — which terms the signed-in user has
 * accepted, and recording a fresh acceptance (the API stores version, time,
 * IP and user-agent as evidence; this app only says *which* document and
 * *which* version was on screen).
 */

export type LegalDocument = 'customer_terms' | 'partner_terms';

export interface LegalDocumentStatus {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  accepted: boolean;
}

export interface LegalStatus {
  customerTerms: LegalDocumentStatus;
  partnerTerms: LegalDocumentStatus;
}

/** The 409 the API answers when the version posted is no longer the current one. */
export const LEGAL_VERSION_OUTDATED = 'LEGAL_VERSION_OUTDATED';

/**
 * Every legal query lives under this prefix. The user id is part of the key so
 * one person's acceptance can never be served from cache to the next person
 * who signs in on the same device.
 */
export const legalKeys = {
  all: ['legal'] as const,
  me: (userId: string | null | undefined) => ['legal', 'me', userId ?? 'anonymous'] as const,
};

export function statusFor(status: LegalStatus, document: LegalDocument): LegalDocumentStatus {
  return document === 'customer_terms' ? status.customerTerms : status.partnerTerms;
}

/**
 * Defensive parse of the response body. A missing or malformed document entry
 * throws rather than defaulting to "accepted" — the gate must never let anyone
 * through on a shape it does not understand — and it never defaults to
 * "not accepted" with an empty version either, since the screen then posts
 * that version back and would be refused.
 */
function parseDocument(raw: unknown, name: string): LegalDocumentStatus {
  const record = (raw ?? null) as Record<string, unknown> | null;
  const currentVersion = record?.currentVersion;

  if (!record || typeof currentVersion !== 'string' || currentVersion === '') {
    throw new Error(`Unexpected /legal/me response: ${name}.currentVersion missing`);
  }

  const acceptedVersion =
    typeof record.acceptedVersion === 'string' ? record.acceptedVersion : null;

  return {
    currentVersion,
    acceptedVersion,
    acceptedAt: typeof record.acceptedAt === 'string' ? record.acceptedAt : null,
    // Only an explicit `true` counts; anything else keeps the gate up.
    accepted: record.accepted === true,
  };
}

export function parseLegalStatus(body: unknown): LegalStatus {
  const record = (body ?? {}) as Record<string, unknown>;
  return {
    customerTerms: parseDocument(record.customerTerms, 'customerTerms'),
    partnerTerms: parseDocument(record.partnerTerms, 'partnerTerms'),
  };
}

export async function fetchLegalStatus(): Promise<LegalStatus> {
  return parseLegalStatus(await apiRequest<unknown>('/api/v1/legal/me'));
}

export async function acceptLegal(document: LegalDocument, version: string): Promise<LegalStatus> {
  return parseLegalStatus(
    await apiRequest<unknown>('/api/v1/legal/accept', {
      method: 'POST',
      body: { document, version },
    }),
  );
}
