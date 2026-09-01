import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';

/// The FixBridge mark.
///
/// One widget rather than an `Image.asset` at each call site: the logo appears
/// on the splash, the language picker and the sign-in screens, and a brand
/// that is subtly different in each of those places reads as three brands.
///
/// The asset carries its own transparency, so it sits on whatever ground the
/// screen already has and needs no plate behind it.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 64});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/brand/logo-mark.png',
      width: size,
      // The mark is wider than it is tall; constraining width alone keeps its
      // proportions rather than squashing it into a square.
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
    );
  }
}

/// The mark and wordmark, with "Partner" named beneath.
///
/// The shared artwork reads "FixBridge" — it is the same brand — so the word
/// that distinguishes this app from the customer one is set here rather than
/// baked into a second image. A technician who installed the wrong app should
/// be able to tell at a glance, and on the launcher the icon does that job in
/// its own way: this app's is the inverted mark on navy.
class BrandLockup extends StatelessWidget {
  const BrandLockup({super.key, this.width = 200});

  final double width;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Image.asset(
          'assets/brand/logo-wordmark.png',
          width: width,
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
        ),
        const SizedBox(height: 6),
        Text(
          'PARTNER',
          style: AppType.label.copyWith(
            color: AppColors.graphite,
            letterSpacing: 3.2,
            fontSize: 10,
          ),
        ),
      ],
    );
  }
}
