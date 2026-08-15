import { z } from 'zod';
import type {
  Badge,
  ProviderDocumentStatus,
  ProviderDocumentType,
  VerificationActorType,
  VerificationEventType,
  VerificationStatus,
} from '@prisma/client';
import { OPS_DECISIONS } from './state-machine';

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

/** Only formats a human reviewer can actually look at. */
export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const requestUploadUrlSchema = z
  .object({
    docType: z.enum(['id_proof', 'certificate', 'photo', 'other']),
    contentType: z.enum(ALLOWED_DOCUMENT_CONTENT_TYPES),
    /**
     * Declared up front because it is signed into the URL — storage then rejects
     * anything of a different size. See `core/storage.ts` for why a pre-signed
     * PUT cannot express "at most N bytes" on its own.
     */
    sizeBytes: z.coerce.number().int().min(1),
  })
  .strict();

export type RequestUploadUrlInput = z.infer<typeof requestUploadUrlSchema>;

export const documentIdParamSchema = z.object({ documentId: z.string().uuid() });

export interface DocumentResponse {
  id: string;
  docType: ProviderDocumentType;
  status: ProviderDocumentStatus;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                      */
/* -------------------------------------------------------------------------- */

export const levelParamSchema = z.object({
  level: z.coerce.number().int().min(0).max(3),
});

export const caseIdParamSchema = z.object({ caseId: z.string().uuid() });

/** The level payload is validated separately, by that level's own schema. */
export const submitLevelSchema = z.object({}).passthrough();

export const provideInfoSchema = z
  .object({
    notes: z.string().trim().min(1).max(2000),
    documentIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .strict();

export type ProvideInfoInput = z.infer<typeof provideInfoSchema>;

export const decideSchema = z
  .object({
    decision: z.enum(OPS_DECISIONS),
    notes: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Refusing someone, or sending them away for more, must be explainable.
    if ((value.decision === 'fail' || value.decision === 'request_info') && !value.notes) {
      ctx.addIssue({
        code: 'custom',
        path: ['notes'],
        message: `notes are required when the decision is ${value.decision}`,
      });
    }
  });

export type DecideInput = z.infer<typeof decideSchema>;

export const queueQuerySchema = z
  .object({
    status: z.enum(['submitted', 'in_review', 'needs_info', 'passed', 'failed']).optional(),
    level: z.coerce.number().int().min(0).max(3).optional(),
    cityId: z.coerce.number().int().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type QueueQuery = z.infer<typeof queueQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export interface VerificationEventResponse {
  id: string;
  eventType: VerificationEventType;
  actorType: VerificationActorType;
  /** Redacted to null for providers — ops notes are internal. */
  notes: string | null;
  payload: unknown;
  createdAt: string;
}

export interface VerificationCaseResponse {
  id: string;
  level: number;
  levelName: string;
  status: VerificationStatus;
  openedAt: string;
  closedAt: string | null;
  events: VerificationEventResponse[];
}

export interface VerificationSummaryResponse {
  badge: Badge;
  badgeSince: string | null;
  levelsPassed: number[];
  levelsRemaining: number[];
}

export interface OpsCaseDocumentResponse extends DocumentResponse {
  /** Short-lived signed URL. Issuing one writes a KYC access-log row. */
  downloadUrl: string;
}
