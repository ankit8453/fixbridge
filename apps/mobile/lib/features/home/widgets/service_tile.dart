import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/category.dart';

/// One service in the home grid.
///
/// A white card with a tinted icon well, not a saturated block: the tint
/// carries the category and the card stays quiet, which is what lets four of
/// them sit together without the grid shouting.
class ServiceTile extends StatelessWidget {
  const ServiceTile({
    super.key,
    required this.category,
    required this.onTap,
  });

  final ServiceCategory category;
  final VoidCallback onTap;

  /// Maps a category to its icon and tint.
  ///
  /// Keyed on the slug the API already ships rather than on an icon field,
  /// because the icons are drawn vectors sized for this grid — a name in the
  /// database cannot describe those. An unknown slug falls through to a
  /// neutral tool icon rather than rendering nothing.
  ({IconData icon, Color color, Color soft}) get _look {
    final slug = category.slug.toLowerCase();

    if (slug.contains('electric')) {
      return (
        icon: Icons.bolt_rounded,
        color: AppColors.catElectric,
        soft: AppColors.catElectricSoft,
      );
    }
    if (slug.contains('plumb') || slug.contains('water')) {
      return (
        icon: Icons.water_drop_rounded,
        color: AppColors.catPlumb,
        soft: AppColors.catPlumbSoft,
      );
    }
    if (slug.contains('ac') ||
        slug.contains('cool') ||
        slug.contains('fridge')) {
      return (
        icon: Icons.ac_unit_rounded,
        color: AppColors.catAc,
        soft: AppColors.catAcSoft,
      );
    }
    if (slug.contains('generator') || slug.contains('inverter')) {
      return (
        icon: Icons.settings_input_svideo_rounded,
        color: AppColors.catGenerator,
        soft: AppColors.catGeneratorSoft,
      );
    }
    if (slug.contains('carpent') || slug.contains('wood')) {
      return (
        icon: Icons.carpenter_rounded,
        color: AppColors.amberText,
        soft: AppColors.amberSoft,
      );
    }
    if (slug.contains('paint')) {
      return (
        icon: Icons.format_paint_rounded,
        color: AppColors.catAc,
        soft: AppColors.catAcSoft,
      );
    }
    return (
      icon: Icons.handyman_rounded,
      color: AppColors.inkMuted,
      soft: AppColors.mist,
    );
  }

  @override
  Widget build(BuildContext context) {
    final look = _look;

    return Material(
      color: AppColors.surface,
      borderRadius: AppRadius.tileR,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.tileR,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md + 2),
          decoration: BoxDecoration(
            borderRadius: AppRadius.tileR,
            border: Border.all(color: AppColors.rule),
            boxShadow: AppColors.cardShadow,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: AppSizes.iconWell,
                height: AppSizes.iconWell,
                decoration: BoxDecoration(
                  color: look.soft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(look.icon, size: 18, color: look.color),
              ),
              const SizedBox(height: AppSpacing.sm + 1),
              Text(
                category.name,
                style: AppType.cardTitle.copyWith(fontSize: 13),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 1),
              Text(
                // The count is a five-minute-old browsing hint, so the copy
                // says "nearby" rather than presenting it as exact.
                category.providerCount == 0
                    ? 'Coming soon'
                    : '${category.providerCount} nearby',
                style: AppType.caption.copyWith(color: AppColors.greyLight),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
