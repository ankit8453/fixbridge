import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/money.dart';
import '../../../data/models/wallet.dart';

/// This week's money.
///
/// The one gradient in the app, spent on the one number a technician opens it
/// to see. Below it the two halves of the wallet sit side by side and are
/// **never netted**: "we owe you ₹4,000, you owe us ₹600" is something they
/// can check against their own week; a single "₹3,400" is not.
class EarningsHeader extends StatelessWidget {
  const EarningsHeader({
    super.key,
    required this.weekPaise,
    required this.weekJobs,
    required this.wallet,
    required this.onTap,
  });

  final int weekPaise;
  final int weekJobs;
  final Wallet? wallet;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.cardR,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.lg + 2),
          decoration: const BoxDecoration(
            gradient: AppColors.earningsGradient,
            borderRadius: AppRadius.cardR,
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              Positioned(
                top: -88,
                right: -56,
                child: Container(
                  width: 200,
                  height: 200,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        Colors.white.withValues(alpha: 0.22),
                        Colors.white.withValues(alpha: 0),
                      ],
                      stops: const [0, 0.66],
                    ),
                  ),
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'THIS WEEK',
                    style: AppType.label.copyWith(
                      color: Colors.white.withValues(alpha: 0.9),
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    Paise.format(weekPaise),
                    style: AppType.hero.copyWith(
                      color: Colors.white,
                      fontSize: 34,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    weekJobs == 0
                        ? 'No jobs finished yet this week'
                        : '$weekJobs ${weekJobs == 1 ? 'job' : 'jobs'} finished',
                    style: AppType.meta.copyWith(
                      color: Colors.white.withValues(alpha: 0.9),
                    ),
                  ),
                  if (wallet != null) ...[
                    const SizedBox(height: AppSpacing.md + 2),
                    Container(
                      padding: const EdgeInsets.only(top: AppSpacing.md + 1),
                      decoration: BoxDecoration(
                        border: Border(
                          top: BorderSide(
                            color: Colors.white.withValues(alpha: 0.22),
                          ),
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: _Half(
                              label: 'WE OWE YOU',
                              value: Paise.show(
                                wallet!.payableDisplay,
                                wallet!.payablePaise,
                              ),
                              tone: const Color(0xFF4ADE80),
                            ),
                          ),
                          Expanded(
                            child: _Half(
                              label: 'YOU OWE US',
                              value: Paise.show(
                                wallet!.duesDisplay,
                                wallet!.duesPaise,
                              ),
                              // Not alarming unless there is something to be
                              // alarmed about — zero dues stay white.
                              tone: wallet!.duesPaise > 0
                                  ? const Color(0xFFFCA5A5)
                                  : Colors.white,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Half extends StatelessWidget {
  const _Half({
    required this.label,
    required this.value,
    required this.tone,
  });

  final String label;
  final String value;
  final Color tone;

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
          style: AppType.amount.copyWith(color: tone, fontSize: 15),
        ),
      ],
    );
  }
}
