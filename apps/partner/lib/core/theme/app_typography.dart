import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Two voices plus a script.
///
/// **Plus Jakarta Sans** is the display face — headlines, amounts, buttons,
/// anything that carries personality. **Inter** is the workhorse for text meant
/// to be read rather than noticed. **Noto Sans Devanagari** is not a fallback
/// in the apologetic sense: it is the face the default language renders in, and
/// it sits in [TextStyle.fontFamilyFallback] on every style so a Hindi name
/// inside an English sentence — which happens on nearly every screen here —
/// renders correctly without anybody choosing a style for it.
///
/// Fonts are fetched at runtime through `google_fonts` for now. On a dropping
/// connection that is a real risk (an unresolved face renders as blank boxes),
/// so SETUP.md carries the step to bundle the three families as assets before
/// release. Switching is a change to this file alone.
abstract final class AppType {
  const AppType._();

  /// Resolved once so every style can list it as a fallback.
  static final List<String> _devanagari = [
    GoogleFonts.notoSansDevanagari().fontFamily!,
  ];

  static TextStyle _display(double size, FontWeight weight, double tracking) {
    return GoogleFonts.plusJakartaSans(
      fontSize: size,
      fontWeight: weight,
      letterSpacing: size * tracking,
      height: 1.12,
    ).copyWith(fontFamilyFallback: _devanagari);
  }

  static TextStyle _body(double size, FontWeight weight, double lineHeight) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      height: lineHeight,
    ).copyWith(fontFamilyFallback: _devanagari);
  }

  // ── Display ────────────────────────────────────────────────────────────
  /// The one big number: an amount paid, a total.
  static TextStyle get hero => _display(42, FontWeight.w800, -0.05);

  /// A screen's title. "On the way", "Ramesh sent the price".
  static TextStyle get title => _display(24, FontWeight.w800, -0.04);

  /// A section heading inside a screen.
  static TextStyle get heading => _display(19, FontWeight.w800, -0.03);

  /// A card's own title, a technician's name.
  static TextStyle get cardTitle => _display(14, FontWeight.w700, -0.015);

  /// Buttons.
  static TextStyle get button => _display(15, FontWeight.w700, -0.015);

  /// Money in a bill row. Tabular so the column of figures lines up — a bill
  /// whose digits wander reads as careless, and this screen is the product.
  static TextStyle get amount => _display(14, FontWeight.w700, -0.01)
      .copyWith(fontFeatures: const [FontFeature.tabularFigures()]);

  static TextStyle get amountLarge => _display(30, FontWeight.w800, -0.045)
      .copyWith(fontFeatures: const [FontFeature.tabularFigures()]);

  /// The OTP digits. Large enough to read out across a room.
  static TextStyle get otpDigit => _display(27, FontWeight.w800, -0.02)
      .copyWith(fontFeatures: const [FontFeature.tabularFigures()]);

  // ── Body ───────────────────────────────────────────────────────────────
  static TextStyle get body => _body(15, FontWeight.w400, 1.55);
  static TextStyle get bodyMedium => _body(14, FontWeight.w500, 1.5);

  /// Metadata under a name: distance, jobs done, locality.
  static TextStyle get meta => _body(11.5, FontWeight.w500, 1.45);

  /// The quietest text in the app — a hint under a field, a waiver note.
  static TextStyle get caption => _body(10.5, FontWeight.w400, 1.5);

  /// Uppercase micro-labels: "START CODE", "RATING".
  static TextStyle get label => _body(9.5, FontWeight.w700, 1.3).copyWith(
        letterSpacing: 1.3,
      );

  /// Numbers that must align in a column or be read aloud digit by digit.
  static TextStyle tabular(TextStyle base) => base.copyWith(
        fontFeatures: const [FontFeature.tabularFigures()],
      );
}
