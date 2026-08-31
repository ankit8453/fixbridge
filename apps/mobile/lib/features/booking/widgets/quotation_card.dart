import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/money.dart';
import '../../../data/models/quotation.dart';
import '../../../shared/widgets/app_button.dart';

/// The price, itemised, with the agreed rate locked.
///
/// This screen is the product. Everything about it is arranged so that a
/// customer can see, without being told, that they are not being overcharged:
///
/// * The **agreed labour** carries a LOCKED chip. That number came from the
///   booking snapshot, is enforced server-side, and a technician cannot move
///   it by asking.
/// * **Extra labour** never appears without the written reason beside it —
///   the API refuses a quotation that tries.
/// * Parts show their arithmetic (`4 m × ₹25`) rather than a bare total.
/// * A **waived visit fee** is shown at ₹0 rather than omitted, so the
///   customer can see it was not charged.
///
/// Deliberately the plainest card in the app: no gradient, no glass. Where
/// money is on screen, decoration reads as misdirection.
class QuotationCard extends StatelessWidget {
  const QuotationCard({
    super.key,
    required this.quotation,
    required this.visitFeePaise,
    this.onApprove,
    this.onReject,
    this.onDecline,
    this.busy = false,
  });

  final Quotation quotation;
  final int visitFeePaise;

  /// Null when this is a historical version rather than the pending one.
  final VoidCallback? onApprove;
  final VoidCallback? onReject;
  final VoidCallback? onDecline;
  final bool busy;

  bool get _isPending => onApprove != null;

  @override
  Widget build(BuildContext context) {
    final agreed = quotation.agreedLabourPaise;
    final extra = quotation.extraLabourPaise ?? 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: AppRadius.cardR,
            border: Border.all(
              color: _isPending ? AppColors.blue : AppColors.rule,
              width: _isPending ? 1.5 : 1,
            ),
            boxShadow: AppColors.cardShadow,
          ),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: Column(
            children: [
              if (agreed != null && agreed > 0)
                _Line(
                  title: 'Agreed labour',
                  subtitle: 'What you booked at',
                  amount: Paise.format(agreed),
                  locked: true,
                ),

              if (extra > 0) ...[
                _Line(
                  title: 'Extra labour',
                  subtitle: 'Found on site',
                  amount: '+ ${Paise.format(extra)}',
                  amountColor: AppColors.amberText,
                ),
                if (quotation.extraLabourReason != null)
                  _Reason(reason: quotation.extraLabourReason!),
              ],

              // Labour with no split at all — an older quotation, or a job
              // with no price card behind it.
              if (agreed == null && quotation.labourPaise > 0)
                _Line(
                  title: 'Labour',
                  amount: Paise.format(quotation.labourPaise),
                ),

              for (final item in quotation.items)
                _Line(
                  title: item.description,
                  subtitle: item.qty > 1 || item.kind == 'part'
                      ? item.unitLabel
                      : null,
                  amount: Paise.format(item.lineTotalPaise),
                ),

              _Line(
                title: 'Visit fee',
                // The fee is the price of turning up, so it is waived when
                // the job actually got done under this quotation.
                subtitle: 'Waived — work completed',
                amount: Paise.format(0),
                amountColor: AppColors.green,
                last: true,
              ),

              const Divider(height: 1, color: AppColors.ink, thickness: 2),
              Padding(
                padding:
                    const EdgeInsets.symmetric(vertical: AppSpacing.md + 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      'Total',
                      style: AppType.cardTitle.copyWith(fontSize: 13.5),
                    ),
                    const Spacer(),
                    Text(
                      Paise.show(quotation.totalDisplay, quotation.totalPaise),
                      style: AppType.amountLarge,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (_isPending) ...[
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 1),
                child: Icon(
                  Icons.shield_outlined,
                  size: 14,
                  color: AppColors.green,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  agreed != null && agreed > 0
                      ? 'The ${Paise.format(agreed)} you booked at cannot be '
                          'changed. Only the extra is new — and it came with a '
                          'reason you just read.'
                      : 'You can say no. Nothing is charged until you approve.',
                  style: AppType.caption.copyWith(color: AppColors.grey),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 'Not this price',
                  kind: AppButtonKind.ghost,
                  onPressed: busy ? null : onReject,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                flex: 3,
                child: AppButton(
                  label:
                      'Approve ${Paise.show(quotation.totalDisplay, quotation.totalPaise)}',
                  kind: AppButtonKind.accent,
                  loading: busy,
                  onPressed: onApprove,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          // Rejecting invites a revision; declining ends the job and makes
          // the visit fee payable. Two different things, so two different
          // controls with very different weight.
          AppButton(
            label: "I don't want the work done",
            kind: AppButtonKind.quiet,
            onPressed: busy ? null : onDecline,
          ),
        ],
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({
    required this.title,
    required this.amount,
    this.subtitle,
    this.locked = false,
    this.amountColor,
    this.last = false,
  });

  final String title;
  final String amount;
  final String? subtitle;
  final bool locked;
  final Color? amountColor;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      decoration: last
          ? null
          : const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: AppColors.ruleFaint),
              ),
            ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        title,
                        style: AppType.bodyMedium.copyWith(fontSize: 13),
                      ),
                    ),
                    if (locked) ...[
                      const SizedBox(width: AppSpacing.sm),
                      const _LockedChip(),
                    ],
                  ],
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 1),
                  Text(
                    subtitle!,
                    style: AppType.caption.copyWith(color: AppColors.greyLight),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Text(
            amount,
            style: AppType.amount.copyWith(color: amountColor),
          ),
        ],
      ),
    );
  }
}

class _LockedChip extends StatelessWidget {
  const _LockedChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: AppColors.blueSoft,
        borderRadius: AppRadius.chipR,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_rounded, size: 8, color: AppColors.blue),
          const SizedBox(width: 3),
          Text(
            'LOCKED',
            style: AppType.label.copyWith(color: AppColors.blue, fontSize: 8),
          ),
        ],
      ),
    );
  }
}

class _Reason extends StatelessWidget {
  const _Reason({required this.reason});

  final String reason;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.amberSoft,
        borderRadius: AppRadius.tileR,
        border: Border.all(color: AppColors.amberLine),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'WHY THE EXTRA',
            style: AppType.label.copyWith(
              color: AppColors.amberText,
              fontSize: 8.5,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            // Verbatim, never summarised. This sentence is the justification
            // the customer is being asked to accept.
            '“$reason”',
            style: AppType.meta.copyWith(
              color: AppColors.amberText,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}
