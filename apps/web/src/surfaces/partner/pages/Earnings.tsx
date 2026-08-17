import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { Card, DetailRow, QueryState, StatusPill } from '../../../components/ui';
import { formatPaise } from '../../../lib/money';
import { fetchWallet } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { WalletLedgerLine } from '../lib/types';

const PAYOUT_STATUS_TONE = { pending: 'warning', paid: 'success', failed: 'danger' } as const;

/**
 * Ledger-line explanations for "dues owed with an explanation of why".
 * `journalType` values come straight from
 * `apps/api/src/modules/payments/service.ts` / `payouts.ts` — there is no
 * memo field on a provider's own ledger view (docs/API.md: memos are
 * written for ops, not for the provider), so the explanation has to be
 * derivable from the type alone, which is exactly what these four cover.
 */
function ledgerLineExplanation(line: WalletLedgerLine, t: ReturnType<typeof useT>): string {
  if (line.journalType === 'cash_collected') return t('partner.earnings.ledger.cashCollected');
  if (line.journalType === 'payment_captured') return t('partner.earnings.ledger.paymentCaptured');
  if (line.journalType === 'dues_settled') return t('partner.earnings.ledger.duesSettled');
  if (line.journalType === 'payout') return t('partner.earnings.ledger.payout');
  if (line.journalType === 'refund') return t('partner.earnings.ledger.refund');
  return t('partner.earnings.ledger.other');
}

export default function Earnings() {
  const t = useT();
  const locale = useLocale();
  const walletQuery = useQuery({ queryKey: partnerKeys.wallet, queryFn: fetchWallet });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.earnings.title')}</h1>

      <QueryState
        status={walletQuery.status}
        error={walletQuery.error}
        data={walletQuery.data}
        onRetry={() => walletQuery.refetch()}
      >
        {({ wallet }) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-medium uppercase text-muted">
                  {t('partner.earnings.payable')}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-green-700">
                  {wallet.payableDisplay}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-medium uppercase text-muted">
                  {t('partner.earnings.dues')}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-danger">
                  {wallet.duesDisplay}
                </p>
              </div>
            </div>

            {wallet.duesPaise > 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t('partner.earnings.duesExplanation')}
              </p>
            ) : null}

            <Card title={t('partner.earnings.netTitle')}>
              <DetailRow label={t('partner.earnings.net')}>{wallet.netDisplay}</DetailRow>
              <DetailRow label={t('partner.earnings.pendingPayout')}>
                {wallet.pendingPayoutPaise > 0
                  ? formatPaise(wallet.pendingPayoutPaise)
                  : t('partner.earnings.none')}
              </DetailRow>
              <DetailRow label={t('partner.earnings.payoutMinimum')}>
                {t('partner.earnings.payoutMinimumHint', {
                  amount: formatPaise(wallet.payoutMinimumPaise),
                })}
              </DetailRow>
            </Card>

            <Card title={t('partner.earnings.payoutsTitle')}>
              {wallet.recentPayouts.length === 0 ? (
                <p className="text-sm text-muted">{t('partner.earnings.noPayouts')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {wallet.recentPayouts.map((payout) => (
                    <li key={payout.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium text-slate-900">{payout.amountDisplay}</p>
                        {payout.utrRef ? (
                          <p className="text-xs text-muted">
                            {t('partner.earnings.utr')}: {payout.utrRef}
                          </p>
                        ) : null}
                      </div>
                      <StatusPill tone={PAYOUT_STATUS_TONE[payout.status]}>
                        {t(`partner.earnings.payoutStatus.${payout.status}`)}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={t('partner.earnings.ledgerTitle')}>
              {wallet.ledger.length === 0 ? (
                <p className="text-sm text-muted">{t('partner.earnings.noLedger')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {wallet.ledger.map((line) => (
                    <li
                      key={line.journalId}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="text-slate-800">{ledgerLineExplanation(line, t)}</p>
                        {line.bookingId ? (
                          <Link
                            to={buildLocalizedHref(locale, `/partner/jobs/${line.bookingId}`)}
                            className="text-xs text-brand"
                          >
                            {t('partner.earnings.viewJob')}
                          </Link>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 tabular-nums font-medium ${line.direction === 'credit' ? 'text-green-700' : 'text-danger'}`}
                      >
                        {line.direction === 'credit' ? '+' : '−'}
                        {line.amountDisplay}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
