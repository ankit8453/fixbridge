import { LegalPage } from '../components/LegalPage';

/**
 * `/terms` — the customer terms for the pilot.
 *
 * Accepted in the app on the screen shown after sign-in; the version accepted
 * is `customer_terms` in `apps/api/src/modules/legal/versions.ts`. Change the
 * substance here and that version must be bumped too.
 */
const SECTIONS = [
  'who',
  'role',
  'eligibility',
  'booking',
  'payment',
  'codes',
  'cancellation',
  'responsibilities',
  'damage',
  'evidence',
  'falseClaims',
  'liability',
  'termination',
  'changes',
  'law',
  'contact',
] as const;

export default function Terms() {
  return <LegalPage ns="terms" pathname="/terms" sections={SECTIONS} />;
}
