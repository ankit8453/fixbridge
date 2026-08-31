import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/provider.dart';
import '../../../shared/widgets/app_card.dart';
import '../../../shared/widgets/avatar.dart';

/// One technician in a result list.
///
/// Carries exactly what the API is willing to give before a booking exists:
/// a name, a badge, a rating (or its honest absence), a rounded distance, a
/// locality name, and a starting price. Never coordinates, never a phone
/// number — those only appear once somebody has accepted a job.
class ProviderCardTile extends StatelessWidget {
  const ProviderCardTile({
    super.key,
    required this.provider,
    required this.onTap,
  });

  final ProviderCard provider;
  final VoidCallback onTap;

  /// "Free today, 2–6 pm" — the thing people actually choose on.
  String? get _availability {
    final next = provider.nextAvailability;
    if (next == null) return null;

    final today = DateTime.now().weekday % 7;
    final when = switch (next.dayOfWeek) {
      _ when next.dayOfWeek == today => 'today',
      _ when next.dayOfWeek == (today + 1) % 7 => 'tomorrow',
      _ => _dayName(next.dayOfWeek),
    };
    return 'Free $when, ${_hour(next.startTime)}–${_hour(next.endTime)}';
  }

  static String _dayName(int d) => switch (d) {
        0 => 'Sunday',
        1 => 'Monday',
        2 => 'Tuesday',
        3 => 'Wednesday',
        4 => 'Thursday',
        5 => 'Friday',
        _ => 'Saturday',
      };

  /// "14:00" reads as a timetable; "2 pm" reads as a person speaking.
  static String _hour(String hhmm) {
    final parts = hhmm.split(':');
    if (parts.length < 2) return hhmm;
    final h = int.tryParse(parts[0]) ?? 0;
    final m = parts[1];
    final period = h < 12 ? 'am' : 'pm';
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return m == '00' ? '$h12 $period' : '$h12:$m $period';
  }

  @override
  Widget build(BuildContext context) {
    final free = _availability;

    return AppCard(
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Avatar(
            name: provider.name,
            size: AppSizes.avatar,
            badge: provider.badge,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        provider.name,
                        style: AppType.cardTitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (provider.badge == TrustBadge.gold) ...[
                      const SizedBox(width: AppSpacing.sm),
                      const BadgeChip(badge: TrustBadge.gold),
                    ],
                  ],
                ),
                const SizedBox(height: AppSpacing.xs + 1),
                Row(
                  children: [
                    RatingChip(rating: provider.rating),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      // Rounded to 0.1 km server-side — too coarse to locate
                      // anybody, precise enough to choose on.
                      '${provider.distanceKm.toStringAsFixed(1)} km',
                      style: AppType.meta.copyWith(
                        color: AppColors.ink,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (provider.locality != null) ...[
                      const SizedBox(width: AppSpacing.sm),
                      Flexible(
                        child: Text(
                          provider.locality!,
                          style: AppType.meta.copyWith(color: AppColors.grey),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ],
                ),
                if (free != null) ...[
                  const SizedBox(height: AppSpacing.xs + 1),
                  Text(
                    free,
                    style: AppType.meta.copyWith(
                      color: AppColors.green,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(provider.priceLabel, style: AppType.amount),
              const SizedBox(height: 1),
              Text(
                'fixed',
                style: AppType.caption.copyWith(
                  color: AppColors.greyLight,
                  fontSize: 8.5,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
