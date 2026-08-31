import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';
import '../core/theme/app_spacing.dart';

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
            _Mark(),
            SizedBox(height: AppSpacing.xl),
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: AppColors.blue,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Mark extends StatelessWidget {
  const _Mark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        gradient: AppColors.liveGradient,
        borderRadius: BorderRadius.circular(20),
      ),
      alignment: Alignment.center,
      child: const Icon(Icons.handyman_rounded, color: Colors.white, size: 30),
    );
  }
}
