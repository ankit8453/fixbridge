import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

enum AppButtonKind {
  /// Ink. The default forward action on a screen.
  primary,

  /// Blue. Reserved for the one moment where the action *is* the accent —
  /// approving a price, paying. Using it everywhere would spend the accent.
  accent,

  /// Outlined. The lesser of two choices sitting beside a primary.
  ghost,

  /// Text on the surface, no chrome. For "Skip".
  quiet,
}

/// The app's button.
///
/// Fixed at [AppSizes.buttonHeight], which is well above the 48dp floor —
/// these are pressed one-handed, often outdoors, sometimes by someone who is
/// not twenty-five.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    this.onPressed,
    this.kind = AppButtonKind.primary,
    this.icon,
    this.loading = false,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final AppButtonKind kind;
  final IconData? icon;

  /// Swaps the label for a spinner and blocks taps. The button keeps its
  /// width so the layout does not jump at the exact moment someone is
  /// watching it.
  final bool loading;

  final bool expand;

  bool get _enabled => onPressed != null && !loading;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, hasBorder, shadow) = switch (kind) {
      AppButtonKind.primary => (
          AppColors.ink,
          Colors.white,
          false,
          AppColors.raisedShadow,
        ),
      AppButtonKind.accent => (
          // The one consequential tap on a screen — approving a price here,
          // accepting a job in the partner app. Named by role so this widget
          // is byte-identical in both.
          AppColors.accentButton,
          Colors.white,
          false,
          AppColors.accentButtonShadow,
        ),
      AppButtonKind.ghost => (
          AppColors.surface,
          AppColors.inkMuted,
          true,
          const <BoxShadow>[],
        ),
      AppButtonKind.quiet => (
          Colors.transparent,
          AppColors.grey,
          false,
          const <BoxShadow>[],
        ),
    };

    final content = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (loading)
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2.2, color: fg),
          )
        else ...[
          if (icon != null) ...[
            Icon(icon, size: 18, color: fg),
            const SizedBox(width: AppSpacing.sm),
          ],
          Flexible(
            child: Text(
              label,
              style: AppType.button.copyWith(color: fg),
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ],
    );

    return Opacity(
      opacity: _enabled ? 1 : 0.45,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: AppRadius.buttonR,
          boxShadow: _enabled ? shadow : const [],
        ),
        // `shape` carries the radius rather than `borderRadius`: Material
        // asserts if both are given, and the ghost variant needs a side.
        child: Material(
          color: bg,
          shape: RoundedRectangleBorder(
            borderRadius: AppRadius.buttonR,
            side: hasBorder
                ? const BorderSide(color: AppColors.rule)
                : BorderSide.none,
          ),
          child: InkWell(
            onTap: _enabled ? onPressed : null,
            borderRadius: AppRadius.buttonR,
            child: SizedBox(
              height: AppSizes.buttonHeight,
              width: expand ? double.infinity : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: Center(child: content),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A small circular icon button — call, back, overflow.
class AppIconButton extends StatelessWidget {
  const AppIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.background = AppColors.surface,
    this.foreground = AppColors.ink,
    this.bordered = true,
    this.size = 38,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final Color background;
  final Color foreground;
  final bool bordered;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: background,
      shape: CircleBorder(
        side: bordered
            ? const BorderSide(color: AppColors.rule)
            : BorderSide.none,
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        // The tap target stays at the 48dp floor even when the painted
        // circle is smaller.
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(icon, size: size * 0.46, color: foreground),
        ),
      ),
    );
  }
}
