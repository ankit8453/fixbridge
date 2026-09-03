import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/money.dart';
import '../../data/models/payout_detail.dart';
import '../../data/models/wallet.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../home/partner_providers.dart';
import '../jobs/job_status_ui.dart';
import 'payout_detail_sheet.dart';

/// The money screen.
///
/// The one screen a technician will check most often and trust least if it is
/// ever wrong, so everything on it is stated rather than netted:
///
///   * What we owe them and what they owe us are **separate figures**. One
///     combined number cannot be checked against their own week.
///   * A payout is **never reduced by dues**. The API works that way and the
///     screen says so, because a smaller transfer than expected is the thing
///     that destroys trust in a wallet.
///   * Cash raises dues, and the ledger line says which job it came from.
class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wallet = ref.watch(walletProvider);

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        bottom: false,
        child: wallet.when(
          loading: () => ListView(
            padding: const EdgeInsets.all(AppSpacing.screenX),
            children: const [
              Shimmer(height: 24, width: 120),
              SizedBox(height: AppSpacing.xl),
              Shimmer(height: 150, radius: 20),
              SizedBox(height: AppSpacing.md),
              Shimmer(height: 90, radius: 20),
            ],
          ),
          error: (e, _) => ErrorState(
            error: e,
            onRetry: () => ref.invalidate(walletProvider),
          ),
          data: (w) => RefreshIndicator(
            color: AppColors.graphite,
            onRefresh: () async {
              ref.invalidate(walletProvider);
              await ref.read(walletProvider.future);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenX,
                AppSpacing.sm,
                AppSpacing.screenX,
                96,
              ),
              children: [
                Text('Money', style: AppType.title),
                const SizedBox(height: AppSpacing.lg),
                _BalanceCard(wallet: w),
                const SizedBox(height: AppSpacing.md),
                const _PayoutDestinationCard(),
                if (w.belowMinimum) ...[
                  const SizedBox(height: AppSpacing.md),
                  _MinimumNote(minimum: w.payoutMinimumPaise),
                ],
                if (w.duesPaise > 0) ...[
                  const SizedBox(height: AppSpacing.md),
                  _DuesNote(wallet: w),
                ],
                if (w.recentPayouts.isNotEmpty) ...[
                  const SectionHeader(title: 'Payouts'),
                  for (final payout in w.recentPayouts)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: _PayoutRow(payout: payout),
                    ),
                ],
                if (w.ledger.isNotEmpty) ...[
                  const SectionHeader(title: 'Everything that moved'),
                  AppCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg,
                    ),
                    child: Column(
                      children: [
                        for (var i = 0; i < w.ledger.length; i++) ...[
                          if (i > 0) const Divider(height: 1),
                          _LedgerRow(line: w.ledger[i]),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    // The API returns one fixed page with no cursor, so
                    // saying so beats an infinite scroll that never loads.
                    'Showing your most recent entries.',
                    style: AppType.caption.copyWith(color: AppColors.greyLight),
                    textAlign: TextAlign.center,
                  ),
                ] else if (w.recentPayouts.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: AppSpacing.xxl),
                    child: EmptyState(
                      icon: Icons.account_balance_wallet_outlined,
                      title: 'Nothing yet',
                      message:
                          'Once you finish a job, what you earned shows up '
                          'here and goes out in the next payout.',
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.wallet});

  final Wallet wallet;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg + 2),
      decoration: const BoxDecoration(
        gradient: AppColors.earningsGradient,
        borderRadius: AppRadius.cardR,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            wallet.owesUs ? 'YOU OWE US' : 'COMING TO YOU',
            style: AppType.label.copyWith(
              color: Colors.white.withValues(alpha: 0.9),
            ),
          ),
          const SizedBox(height: 5),
          Text(
            // netDisplay from the API is absolute-valued — the sign is
            // stripped — so this is formatted from netPaise and labelled by
            // direction instead. Rendering the API's string alone would show
            // a positive figure on a negative balance.
            wallet.netDisplay,
            style: AppType.hero.copyWith(
              color: wallet.owesUs
                  ? const Color(0xFFFCA5A5)
                  : const Color(0xFF4ADE80),
              fontSize: 36,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Container(
            padding: const EdgeInsets.only(top: AppSpacing.md + 1),
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(color: Colors.white.withValues(alpha: 0.22)),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _Half(
                    label: 'WE OWE YOU',
                    value: Paise.show(
                      wallet.payableDisplay,
                      wallet.payablePaise,
                    ),
                  ),
                ),
                Expanded(
                  child: _Half(
                    label: 'YOU OWE US',
                    value: Paise.show(wallet.duesDisplay, wallet.duesPaise),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Half extends StatelessWidget {
  const _Half({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppType.label.copyWith(
            color: Colors.white.withValues(alpha: 0.85),
            fontSize: 9,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: AppType.amount.copyWith(color: Colors.white, fontSize: 16),
        ),
      ],
    );
  }
}

class _MinimumNote extends StatelessWidget {
  const _MinimumNote({required this.minimum});

  final int minimum;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      color: AppColors.amberSoft,
      borderColor: AppColors.amberLine,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.info_outline_rounded,
            size: 16,
            color: AppColors.amber,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              // Explained rather than left as a silent absence: a technician
              // who expected a transfer and got none assumes a bug.
              'Payouts go out above ${Paise.format(minimum)}. What you have '
              'now carries over to the next one — nothing is lost.',
              style: AppType.meta.copyWith(color: AppColors.amber),
            ),
          ),
        ],
      ),
    );
  }
}

class _DuesNote extends StatelessWidget {
  const _DuesNote({required this.wallet});

  final Wallet wallet;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Why you owe us', style: AppType.cardTitle),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'When a customer pays you in cash, the whole amount stays with '
            'you — so our commission on those jobs is added here instead.',
            style: AppType.meta.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.mist,
              borderRadius: AppRadius.tileR,
            ),
            child: Text(
              // Stated because the opposite would be a nasty surprise, and
              // the API deliberately does not net them.
              'Your payouts are not reduced by this. It is settled separately.',
              style: AppType.meta.copyWith(
                color: AppColors.inkMuted,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PayoutRow extends StatelessWidget {
  const _PayoutRow({required this.payout});

  final Payout payout;

  @override
  Widget build(BuildContext context) {
    final (label, tone, soft) = switch (payout.status) {
      'paid' => ('Paid', AppColors.green, AppColors.greenSoft),
      'failed' => ('Did not go through', AppColors.red, AppColors.redSoft),
      _ => ('On its way', AppColors.amber, AppColors.amberSoft),
    };

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm + 2,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: soft,
                  borderRadius: AppRadius.chipR,
                ),
                child: Text(
                  label,
                  style: AppType.meta.copyWith(
                    color: tone,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const Spacer(),
              Text(
                Paise.show(payout.amountDisplay, payout.amountPaise),
                style: AppType.amount,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            formatWhen(payout.paidAt ?? payout.createdAt),
            style: AppType.caption.copyWith(color: AppColors.greyLight),
          ),

          // The bank reference — what they check their passbook against.
          if (payout.utrRef != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: AppRadius.tileR,
              ),
              child: Row(
                children: [
                  Text(
                    'REF',
                    style: AppType.label.copyWith(
                      color: AppColors.greyLight,
                      fontSize: 8.5,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      payout.utrRef!,
                      style: AppType.meta.copyWith(
                        color: AppColors.inkMuted,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          if (payout.isFailed) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              // A failed payout posts nothing — the balance was never reduced
              // and rolls into the next batch. Worth saying, because the word
              // "failed" reads as money lost.
              'Nothing was taken from your balance. It will go out again in '
              'the next payout.',
              style: AppType.caption.copyWith(color: AppColors.grey),
            ),
          ],
        ],
      ),
    );
  }
}

class _LedgerRow extends StatelessWidget {
  const _LedgerRow({required this.line});

  final LedgerLine line;

  @override
  Widget build(BuildContext context) {
    // A credit to them is money in; a debit is money out or owed.
    final incoming = line.direction == 'credit';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(line.label,
                    style: AppType.bodyMedium.copyWith(fontSize: 13)),
                const SizedBox(height: 1),
                Text(
                  formatWhen(line.createdAt),
                  style: AppType.caption.copyWith(color: AppColors.greyLight),
                ),
              ],
            ),
          ),
          Text(
            '${incoming ? '+' : '−'} ${Paise.show(line.amountDisplay, line.amountPaise)}',
            style: AppType.amount.copyWith(
              fontSize: 13,
              color: incoming ? AppColors.green : AppColors.inkMuted,
            ),
          ),
        ],
      ),
    );
  }
}

/// Where the next payout lands, or a prompt if nobody has said yet.
///
/// Sits directly under the balance on purpose. The moment a technician has
/// money owing is the moment this matters, and burying it in a settings screen
/// means the first they learn of it is a payout run that skipped them.
class _PayoutDestinationCard extends ConsumerWidget {
  const _PayoutDestinationCard();

  Future<void> _edit(BuildContext context, PayoutDetail? existing) async {
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (_) => PayoutDetailSheet(existing: existing),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Never hidden, whatever the request does.
    //
    // The first version drew an empty box while loading and on error, on the
    // reasoning that a failed side request should not put an error where
    // somebody is reading their balance. That was wrong in the way that
    // matters: this card *is* the feature. One failed call and a technician
    // has no way to tell us where to send their money, and no sign such a
    // thing exists — indistinguishable from it never having been built.
    //
    // So an unknown answer falls through to the prompt. Tapping it opens the
    // form, which reports its own failures properly, and the worst case is
    // being asked for details already given.
    final value = ref.watch(payoutDetailProvider).valueOrNull;

    return AppCard(
      child: InkWell(
        onTap: () => _edit(context, value),
        borderRadius: AppRadius.tileR,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            children: [
              Icon(
                value == null
                    ? Icons.error_outline_rounded
                    : value.isBank
                        ? Icons.account_balance_rounded
                        : Icons.qr_code_rounded,
                size: 20,
                color: value == null ? AppColors.amberText : AppColors.grey,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      value == null
                          ? 'Tell us where to send your money'
                          : 'Payouts go to',
                      style: AppType.bodyMedium,
                    ),
                    const SizedBox(height: 1),
                    Text(
                      value == null
                          ? 'We cannot pay you until you add this'
                          : value.destination,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption.copyWith(
                        color: value == null
                            ? AppColors.amberText
                            : AppColors.greyLight,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: AppColors.greyLight,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
