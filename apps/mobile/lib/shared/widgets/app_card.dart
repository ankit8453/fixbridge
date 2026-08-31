import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

/// The surface everything sits on.
///
/// White on the near-white ground, a hairline border, and a shadow faint
/// enough that you notice the separation rather than the shadow. The border
/// does most of the work — a heavy drop shadow is what makes a light UI look
/// cheap.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md + 1),
    this.onTap,
    this.selected = false,
    this.color,
    this.borderColor,
    this.radius = AppRadius.cardR,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  /// Draws the blue border and tint. The accent means "chosen" here, which is
  /// the same thing it means everywhere else in the app.
  final bool selected;

  final Color? color;
  final Color? borderColor;
  final BorderRadius radius;

  @override
  Widget build(BuildContext context) {
    final border = borderColor ??
        (selected ? AppColors.blue : AppColors.rule);

    final body = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? (selected ? AppColors.blueSoft : AppColors.surface),
        borderRadius: radius,
        border: Border.all(color: border, width: selected ? 1.5 : 1),
        boxShadow: AppColors.cardShadow,
      ),
      child: child,
    );

    if (onTap == null) return body;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: body,
      ),
    );
  }
}

/// A heading above a group, with an optional action on the right.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(
        top: AppSpacing.lg + 2,
        bottom: AppSpacing.sm + 2,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Expanded(child: Text(title, style: AppType.cardTitle)),
          if (actionLabel != null)
            GestureDetector(
              onTap: onAction,
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                child: Text(
                  actionLabel!,
                  style: AppType.meta.copyWith(
                    color: AppColors.blue,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A small pill: a filter, a review tag, a status word.
class AppChip extends StatelessWidget {
  const AppChip({
    super.key,
    required this.label,
    this.selected = false,
    this.onTap,
    this.color,
    this.background,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final Color? color;
  final Color? background;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final fg = color ?? (selected ? AppColors.blue : AppColors.grey);
    final bg = background ??
        (selected ? AppColors.blueSoft : AppColors.surface);

    return Material(
      color: bg,
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.chipR,
        side: BorderSide(color: selected ? AppColors.blue : AppColors.rule),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm + 1,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 13, color: fg),
                const SizedBox(width: 5),
              ],
              Text(
                label,
                style: AppType.meta.copyWith(
                  color: fg,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
