import type { LegalDocument } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { CURRENT_LEGAL_VERSIONS } from './versions';

export interface LegalDocumentStatus {
  /** The version the person must accept to carry on. */
  currentVersion: string;
  /** The newest version they have accepted, or null if none. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** True when `acceptedVersion` is the current one. */
  accepted: boolean;
}

export interface LegalStatus {
  customerTerms: LegalDocumentStatus;
  partnerTerms: LegalDocumentStatus;
}

async function statusFor(
  context: AppContext,
  userId: string,
  document: LegalDocument,
): Promise<LegalDocumentStatus> {
  const currentVersion = CURRENT_LEGAL_VERSIONS[document];

  // The current version first if it exists, otherwise the latest one.
  const current = await context.prisma.legalAcceptance.findUnique({
    where: { userId_document_version: { userId, document, version: currentVersion } },
  });
  const latest =
    current ??
    (await context.prisma.legalAcceptance.findFirst({
      where: { userId, document },
      orderBy: { acceptedAt: 'desc' },
    }));

  return {
    currentVersion,
    acceptedVersion: latest?.version ?? null,
    acceptedAt: latest?.acceptedAt.toISOString() ?? null,
    accepted: current !== null,
  };
}

export async function getLegalStatus(context: AppContext, userId: string): Promise<LegalStatus> {
  const [customerTerms, partnerTerms] = await Promise.all([
    statusFor(context, userId, 'customer_terms'),
    statusFor(context, userId, 'partner_terms'),
  ]);

  return { customerTerms, partnerTerms };
}

/**
 * Records that a person accepted `version` of `document`.
 *
 * The client sends back the version it showed. If that is no longer current,
 * the person agreed to text that has since changed, so this refuses rather
 * than quietly recording the new version against them.
 *
 * Accepting the same version twice is harmless: the first record (and its
 * timestamp) is kept.
 */
export async function acceptLegalDocument(
  context: AppContext,
  userId: string,
  input: { document: LegalDocument; version: string },
  info: { ip: string | null; userAgent: string | null },
): Promise<LegalStatus> {
  if (input.version !== CURRENT_LEGAL_VERSIONS[input.document]) {
    throw new AppError(
      409,
      'LEGAL_VERSION_OUTDATED',
      `Terms version ${input.version} is not current for ${input.document}`,
      { messageKey: 'errors.legal.versionOutdated' },
    );
  }

  await context.prisma.legalAcceptance.upsert({
    where: {
      userId_document_version: { userId, document: input.document, version: input.version },
    },
    create: {
      userId,
      document: input.document,
      version: input.version,
      ip: info.ip ? info.ip.slice(0, 64) : null,
      userAgent: info.userAgent ? info.userAgent.slice(0, 512) : null,
    },
    update: {},
  });

  return getLegalStatus(context, userId);
}
