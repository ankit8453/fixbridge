import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// Assembles the Material theme from the tokens.
///
/// Light only, and that is a decision rather than an omission. The customers
/// this is built for read the screen outdoors — in a doorway, on a stairwell
/// landing, at midday — and a dark surface on a cheap LCD in that light is
/// measurably harder to read. When a dark theme arrives it will be a setting
/// people opt into, not the default the OS picks for them.
abstract final class AppTheme {
  const AppTheme._();

  static ThemeData get light {
    final base = ThemeData.light(useMaterial3: true);

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.ground,
      colorScheme: base.colorScheme.copyWith(
        primary: AppColors.blue,
        onPrimary: Colors.white,
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
        // The real status bar renders over the app. Painting a light scrim
        // under dark icons is all that is needed; drawing a fake bar would
        // double up with the device's own.
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
      // Each platform gets the transition its users already expect: Android
      // the zoom, iOS the horizontal slide-back. Same codebase, native feel.
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: ZoomPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
    );
  }
}
