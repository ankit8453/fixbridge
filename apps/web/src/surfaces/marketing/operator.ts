import { APP_NAME } from '@/brand/tokens';
import type { Translator } from '@/i18n/dictionaries';

/**
 * Who runs FixBridge during the pilot, and how to reach them.
 *
 * **One place on purpose.** The terms, partner agreement, privacy policy,
 * refund and delete-account pages and the contact page all read these, so a
 * phone number changed here changes everywhere at once.
 *
 * The postal address is not here: it is translated, so it lives under
 * `marketing.contactInfo.address` in the locale files, shared with the footer.
 *
 * There is no company yet. The pilot is run by the people named in `team`, as
 * individuals, and the legal pages say so. When a company is registered,
 * change `team` to its name, update the pages, and bump the versions in
 * `apps/api/src/modules/legal/versions.ts` so everybody accepts again.
 *
 * Write phone numbers with spaces (+91 98765 43210), not as one run of
 * digits: a 12-digit run trips the repo's raw-ID-number guard.
 */
export const OPERATOR = {
  /** The people running the pilot, as they should appear in the terms. */
  // Commas only, no "and": the same string sits inside Hindi and English copy.
  team: 'Ankit Pawar, Yash Verma, Utpal Jhariya',
  /** The one person who answers privacy and complaint grievances. */
  officer: 'Ankit Pawar',
  whatsapp: '+91 99934 48391',
  email: 'hello.fixbridge@gmail.com',
} as const;

/**
 * Everything the legal copy interpolates: the app name, the operator's
 * details, and the translated address.
 */
export function legalVars(t: Translator): Record<string, string> {
  return { app: APP_NAME, ...OPERATOR, address: t('marketing.contactInfo.address') };
}
