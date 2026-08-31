import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/booking.dart';
import '../../../data/models/money.dart';
import '../../../shared/widgets/app_card.dart';
import '../job_status_ui.dart';

/// One job in a list.
///
/// Leads with what to do next rather than what state it is in — a technician
/// scanning this between jobs wants "ask for the start code", not "ARRIVED".
class JobRow extends StatelessWidget {
  const JobRow({super.key, required this.booking, required this.onTap});

  final Booking booking;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = booking.status;
    final next = status.nextAction;

    return AppCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: status.toneSoft,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(status.icon, size: 18, color: status.tone),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      booking.counterpart.displayName,
                      style: AppType.cardTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      formatWhen(booking.startsAt),
                      style: AppType.meta.copyWith(color: AppColors.grey),
                    ),
                  ],
                ),
              ),
              // The settled amount once there is one; before that the agreed
              // rate, which is what they will be paid at minimum.
              Text(
                Paise.format(
                  booking.payablePaise ?? booking.agreedLabour.amountPaise ?? 0,
                ),
                style: AppType.amount.copyWith(
                  color: booking.status == BookingStatus.workDone
                      ? AppColors.green
                      : AppColors.ink,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm + 2,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: status.toneSoft,
                  borderRadius: AppRadius.chipR,
                ),
                child: Text(
                  status.partnerLabel,
                  style: AppType.meta.copyWith(
                    color: status.tone,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (next.isNotEmpty) ...[
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    next,
                    style: AppType.caption.copyWith(color: AppColors.greyLight),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
