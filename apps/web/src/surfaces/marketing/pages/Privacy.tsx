import { LegalPage } from '../components/LegalPage';

/**
 * `/privacy` — written against India's DPDP Act, 2023: what is collected,
 * why, who sees it, how long it is kept, and the rights the Act gives.
 *
 * Accepted together with the customer terms and the partner agreement, so a
 * change in substance here means bumping both versions in
 * `apps/api/src/modules/legal/versions.ts`.
 */
const SECTIONS = [
  'dataCollected',
  'purpose',
  'sharing',
  'retention',
  'security',
  'rights',
  'grievance',
  'children',
  'changes',
] as const;

export default function Privacy() {
  return <LegalPage ns="privacy" pathname="/privacy" sections={SECTIONS} />;
}
