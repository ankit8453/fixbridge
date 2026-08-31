import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// The partner theme.
///
/// Structurally identical to the customer app — same type, same spacing, same
/// radii — with graphite where that one uses blue. Two apps that feel like one
/// company, told apart instantly by colour rather than by layout.
abstract final class AppTheme {
  const AppTheme._();

  static ThemeData get light {
    final base = ThemeData.light(useMaterial3: true);

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.ground,
      colorScheme: base.colorScheme.copyWith(
        primary: AppColors.graphite,
        onPrimary: Colors.white,
        // Green is the secondary because it carries the two things a
        // technician looks for: money, and the button that earns it.
        secondary: AppColors.green,
        surface: AppColors.surface,
        onSurface: AppColors.ink,
        error: AppColors.red,
        outline: AppColors.rule,
      ),
      textTheme: base.textTheme.apply(
        bodyColor: AppColors.ink,
        displayColor: AppColors.ink,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.ground,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: AppType.heading.copyWith(color: AppColors.ink),
        iconTheme: const IconThemeData(color: AppColors.ink, size: 22),
        systemOverlayStyle: SystemUiOverlayStyle.dark.copyWith(
          statusBarColor: Colors.transparent,
          systemNavigationBarColor: AppColors.ground,
          systemNavigationBarIconBrightness: Brightness.dark,
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.ruleFaint,
        thickness: 1,
        space: 1,
      ),
      splashFactory: InkSparkle.splashFactory,
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadius.sheet),
          ),
        ),
        showDragHandle: true,
        dragHandleColor: AppColors.rule,
        constraints: BoxConstraints(maxWidth: double.infinity),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.ink,
        contentTextStyle: AppType.bodyMedium.copyWith(color: Colors.white),
        behavior: SnackBarBehavior.floating,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(AppRadius.field)),
        ),
        insetPadding: const EdgeInsets.all(AppSpacing.lg),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: ZoomPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
    );
  }
}
