import { LegalPage } from '../components/LegalPage';

/** `/refund-policy` — cancellation and refunds while the pilot is cash only. */
const SECTIONS = ['noMoney', 'cancel', 'technicianCancels', 'unhappy', 'future'] as const;

export default function RefundPolicy() {
  return <LegalPage ns="refund" pathname="/refund-policy" sections={SECTIONS} />;
}
