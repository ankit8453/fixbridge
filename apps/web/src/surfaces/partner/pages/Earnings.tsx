import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  ChevronRight,
  Landmark,
  Receipt,
  Wallet,
} from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { QueryState } from '../../../components/ui';
import {
  EmptyState,
  Grid,
  PageHeader,
  Panel,
  StatTile,
  StatusPill,
  type Tone,
} from '../components/ui';
import { formatPaise } from '../../../lib/money';
import { PayoutDetailPanel } from '../components/PayoutDetailPanel';
import { fetchWallet } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { WalletLedgerLine } from '../lib/types';

const PAYOUT_STATUS_TONE: Record<'pending' | 'paid' | 'failed', Tone> = {
  pending: 'warning',
  paid: 'success',
  failed: 'danger',
};

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

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: '2-digit',
      month: 'short',
    });

  return (
    <>
      <PageHeader
        title={t('partner.earnings.title')}
        description={t('partner.earnings.subtitle')}
      />

      <QueryState
        status={walletQuery.status}
        error={walletQuery.error}
        data={walletQuery.data}
        onRetry={() => walletQuery.refetch()}
      >
        {({ wallet }) => (
          <div className="flex flex-col gap-4 lg:gap-5">
            {/* The four numbers a technician opens this screen to read, before
                any explanation of how they were arrived at. */}
            <Grid cols={4}>
              <StatTile
                label={t('partner.earnings.payable')}
                value={wallet.payableDisplay}
                icon={Wallet}
                tone="success"
              />
              <StatTile
                label={t('partner.earnings.dues')}
                value={wallet.duesDisplay}
                icon={Receipt}
                tone={wallet.duesPaise > 0 ? 'danger' : 'neutral'}
              />
              <StatTile
                label={t('partner.earnings.net')}
                value={wallet.netDisplay}
                icon={Banknote}
                tone="brand"
              />
              <StatTile
                label={t('partner.earnings.pendingPayout')}
                value={
                  wallet.pendingPayoutPaise > 0
                    ? formatPaise(wallet.pendingPayoutPaise)
                    : t('partner.earnings.none')
                }
                hint={t('partner.earnings.payoutMinimumHint', {
                  amount: formatPaise(wallet.payoutMinimumPaise),
                })}
                icon={Landmark}
                // Amber while money is in flight: a pending payout is a state, and a grey
                // chip reads as 'nothing here' next to the tiles either side of it.
                tone={wallet.pendingPayoutPaise > 0 ? 'warning' : 'neutral'}
              />
            </Grid>

            {/* Directly under the numbers, not in a settings page. The moment
                somebody has money owing is the only moment this form is worth
                filling in — buried elsewhere, the first they learn it exists is
                a payout run that skipped them. */}
            <PayoutDetailPanel />

            {/* Only shown when money is actually owed — an explanation of a
                zero balance is noise on the one screen that must stay scannable. */}
            {wallet.duesPaise > 0 ? (
              <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-warning"
                  aria-hidden="true"
                  strokeWidth={2}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {t('partner.earnings.duesTitle', { amount: wallet.duesDisplay })}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {t('partner.earnings.duesExplanation')}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-5">
              {/* The statement is the page's substance, so it takes the wider
                  column; payouts are a short reference list beside it. */}
              <div className="lg:col-span-3">
                <Panel
                  title={t('partner.earnings.ledgerTitle')}
                  description={t('partner.earnings.ledgerHint')}
                  padded={false}
                >
                  {wallet.ledger.length === 0 ? (
                    <EmptyState
                      icon={Receipt}
                      title={t('partner.earnings.noLedger')}
                      description={t('partner.earnings.noLedgerHint')}
                    />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {wallet.ledger.map((line) => {
                        const credit = line.direction === 'credit';
                        return (
                          <li
                            key={line.journalId}
                            className="flex items-start gap-3 px-4 py-3.5 lg:px-5"
                          >
                            <span
                              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                credit ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                              }`}
                            >
                              {credit ? (
                                <ArrowDownLeft
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                  strokeWidth={2.25}
                                />
                              ) : (
                                <ArrowUpRight
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                  strokeWidth={2.25}
                                />
                              )}
                            </span>

                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-900">
                                {ledgerLineExplanation(line, t)}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="text-xs tabular-nums text-slate-500">
                                  {dateLabel(line.createdAt)}
                                </span>
                                {line.bookingId ? (
                                  <Link
                                    to={buildLocalizedHref(
                                      locale,
                                      `/partner/jobs/${line.bookingId}`,
                                    )}
                                    className="inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline"
                                  >
                                    {t('partner.earnings.viewJob')}
                                    <ChevronRight
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                      strokeWidth={2}
                                    />
                                  </Link>
                                ) : null}
                              </div>
                            </div>

                            <span
                              className={`shrink-0 text-sm font-semibold tabular-nums ${
                                credit ? 'text-success' : 'text-danger'
                              }`}
                            >
                              {credit ? '+' : '−'}
                              {line.amountDisplay}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </div>

              <div className="lg:col-span-2">
                <Panel title={t('partner.earnings.payoutsTitle')} padded={false}>
                  {wallet.recentPayouts.length === 0 ? (
                    <EmptyState
                      icon={Landmark}
                      title={t('partner.earnings.noPayouts')}
                      description={t('partner.earnings.noPayoutsHint')}
                    />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {wallet.recentPayouts.map((payout) => (
                        <li key={payout.id} className="px-4 py-3.5 lg:px-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold tabular-nums text-slate-900">
                                {payout.amountDisplay}
                              </p>
                              <p className="mt-1 text-xs tabular-nums text-slate-500">
                                {dateLabel(payout.paidAt ?? payout.createdAt)}
                              </p>
                            </div>
                            <StatusPill tone={PAYOUT_STATUS_TONE[payout.status]}>
                              {t(`partner.earnings.payoutStatus.${payout.status}`)}
                            </StatusPill>
                          </div>
                          {payout.utrRef ? (
                            <p className="mt-2 truncate text-xs text-slate-500">
                              {t('partner.earnings.utr')}:{' '}
                              <span className="font-medium tabular-nums text-slate-700">
                                {payout.utrRef}
                              </span>
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
