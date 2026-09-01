import 'package:flutter/widgets.dart';

/// Spacing, radii and hit targets.
///
/// The scale is deliberately short. A long scale is one where two developers
/// pick 14 and 15 for the same gap and the screen quietly goes crooked.
abstract final class AppSpacing {
  const AppSpacing._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;

  /// The horizontal margin every screen shares. Change it here and the whole
  /// app moves together.
  static const screenX = 18.0;

  /// Distance from the last control to the bottom safe area.
  static const screenBottom = 16.0;

  /// The bottom padding a modal bottom sheet needs.
  ///
  /// Three things stack up under a sheet and all three have to be cleared, or
  /// the last control — nearly always Save or Sign out — ends up underneath
  /// something and cannot be tapped:
  ///
  ///   * the keyboard, when open (`viewInsets`),
  ///   * the system gesture bar (`viewPadding`),
  ///   * the app's own floating navigation bar, which `extendBody: true`
  ///     lets the sheet slide beneath.
  ///
  /// `viewInsets` already subsumes `viewPadding` while the keyboard is up, so
  /// these are taken as a maximum rather than a sum.
  static double sheetBottom(BuildContext context) {
    final media = MediaQuery.of(context);
    final keyboard = media.viewInsets.bottom;
    final system = media.viewPadding.bottom;

    return (keyboard > 0 ? keyboard : system + _floatingNavHeight) + xl;
  }

  /// The floating nav's own height plus the gap beneath it.
  ///
  /// Derived from the same tokens AppShell builds it from — a touch target,
  /// the pill's vertical padding either side, and the shell's bottom margin —
  /// so moving any of them moves this with it instead of silently drifting.
  static const _floatingNavHeight = AppSizes.minTouch + (sm + 1) * 2 + md;
}

abstract final class AppRadius {
  const AppRadius._();

  static const chip = 999.0;
  static const field = 16.0;
  static const button = 16.0;
  static const tile = 18.0;
  static const card = 20.0;
  static const sheet = 28.0;

  static const cardR = BorderRadius.all(Radius.circular(card));
  static const tileR = BorderRadius.all(Radius.circular(tile));
  static const fieldR = BorderRadius.all(Radius.circular(field));
  static const buttonR = BorderRadius.all(Radius.circular(button));
  static const chipR = BorderRadius.all(Radius.circular(chip));
}

abstract final class AppSizes {
  const AppSizes._();

  /// Nothing tappable is smaller than this. The customers this is built for
  /// are often outdoors, one-handed, and not twenty-five.
  static const minTouch = 48.0;

  static const buttonHeight = 52.0;
  static const fieldHeight = 52.0;
  static const avatar = 46.0;
  static const avatarLarge = 86.0;
  static const iconWell = 38.0;
}

/// Motion. Feedback only — nothing here loops for decoration.
abstract final class AppMotion {
  const AppMotion._();

  /// A tap acknowledging itself.
  static const quick = Duration(milliseconds: 160);

  /// A card appearing, a sheet settling, a state changing.
  static const base = Duration(milliseconds: 240);

  /// A booking advancing a stage — slow enough to be noticed as an event.
  static const slow = Duration(milliseconds: 400);

  /// The live pulse on an in-progress booking.
  static const pulse = Duration(milliseconds: 2200);

  static const enter = Curves.easeOutCubic;
  static const spring = Cubic(0.2, 0.8, 0.3, 1.1);
}
