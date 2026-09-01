import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';
import '../core/theme/app_spacing.dart';
import '../shared/widgets/brand_mark.dart';

/// Held only while the stored session is exchanged for a live one.
///
/// Deliberately almost empty. A splash screen with a tagline is a splash
/// screen somebody is being made to look at; this one is gone the moment
/// `/auth/refresh` answers, and on a warm start that is a few hundred
/// milliseconds.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.ground,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            BrandLockup(width: 190),
            SizedBox(height: AppSpacing.xl),
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: AppColors.graphite,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
