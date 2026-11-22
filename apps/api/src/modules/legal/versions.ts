import type { LegalDocument } from '@prisma/client';

/**
 * The version of each set of terms that people must accept today.
 *
 * Bump a date here **only** when the matching page on the website changes in
 * substance — `/terms` for customers, `/partner-terms` for technicians (each
 * also covers `/privacy`). Every signed-in person is then asked to accept
 * again before they can carry on, and their earlier acceptance stays on
 * record. Keep the "Last updated" line on the page in step with this date.
 */
export const CURRENT_LEGAL_VERSIONS: Readonly<Record<LegalDocument, string>> = {
  customer_terms: '2026-11-15',
  partner_terms: '2026-11-15',
};
