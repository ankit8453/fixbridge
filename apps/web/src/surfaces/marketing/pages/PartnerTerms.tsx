import { LegalPage } from '../components/LegalPage';

/**
 * `/partner-terms` — the technician agreement for the pilot.
 *
 * Accepted in the partner app after sign-in; the version accepted is
 * `partner_terms` in `apps/api/src/modules/legal/versions.ts`. Change the
 * substance here and that version must be bumped too.
 */
const SECTIONS = [
  'who',
  'relationship',
  'eligibility',
  'commission',
  'conduct',
  'process',
  'responsibility',
  'customerPrivacy',
  'evidence',
  'suspension',
  'liability',
  'termination',
  'changes',
  'law',
  'contact',
] as const;

export default function PartnerTerms() {
  return <LegalPage ns="partnerTerms" pathname="/partner-terms" sections={SECTIONS} />;
}
