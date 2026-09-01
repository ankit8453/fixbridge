import 'package:flutter/material.dart';

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

/// The mark with the FixBridge wordmark beneath it, for screens that are
/// introducing the app rather than continuing it.
class BrandLockup extends StatelessWidget {
  const BrandLockup({super.key, this.width = 200});

  final double width;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/brand/logo-wordmark.png',
      width: width,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
    );
  }
}
