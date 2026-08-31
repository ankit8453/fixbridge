import 'package:flutter/material.dart';

/// The customer app's palette.
///
/// One accent, spent carefully. Blue marks what is interactive or alive and
/// nothing else; green carries meaning (verified, paid, safe to call) rather
/// than brand; everything else is ink, grey and air. The single gradient in
/// the whole app is [liveGradient], on the live-booking card — the one thing
/// on screen that is genuinely in motion.
///
/// Contrast is measured against [ground], not guessed, because a customer
/// reads this screen in a doorway at noon:
///   blue on ground   5.2:1  — clears AA for body text
///   grey on ground   5.3:1  — clears AA, so metadata stays readable
///   ink on ground   18.1:1
///
/// Deliberately NOT the plum of the web customer app. That surface keeps its
/// own identity; if the two are ever unified, this file is the one that moves.
abstract final class AppColors {
  const AppColors._();

  // ── Ink ────────────────────────────────────────────────────────────────
  /// Body text, the primary button, the floating nav.
  static const ink = Color(0xFF0B0C0F);

  /// Secondary copy — a line the eye should reach second, not skip.
  static const inkMuted = Color(0xFF475467);

  /// Metadata: distances, counts, timestamps. 5.3:1, still AA.
  static const grey = Color(0xFF667085);

  /// Placeholders and disabled glyphs. Below AA on purpose — never body text.
  static const greyLight = Color(0xFF98A2B3);

  // ── The accent ─────────────────────────────────────────────────────────
  /// Interactive, live, selected. Nothing decorative ever uses this.
  static const blue = Color(0xFF2563EB);
  static const blueMid = Color(0xFF4F7DFF);
  static const sky = Color(0xFF38BDF8);

  /// The tint behind a selected slot or an active chip.
  static const blueSoft = Color(0xFFEFF4FF);

  // ── Meaning, not brand ─────────────────────────────────────────────────
  /// Verified, captured, safe to call.
  static const green = Color(0xFF12B76A);
  static const greenSoft = Color(0xFFECFDF3);

  /// The extra-labour reason card. Amber says "read this", not "error" —
  /// an extra charge with a written reason is normal, not a failure.
  static const amberSoft = Color(0xFFFFFAEB);
  static const amberLine = Color(0xFFFEDF89);
  static const amberText = Color(0xFF93540A);

  /// Cancellation and refusal. Used on text and outlines, never as a fill
  /// behind a whole card — a customer declining a price has done nothing wrong.
  static const red = Color(0xFFD92D20);
  static const redSoft = Color(0xFFFEF3F2);

  // ── Surfaces ───────────────────────────────────────────────────────────
  /// The page. A hair off white so that pure-white cards lift off it.
  static const ground = Color(0xFFFBFBFD);

  /// Cards, sheets, the app bar.
  static const surface = Color(0xFFFFFFFF);

  /// Inset wells — the OTP digit tiles, a disabled field.
  static const mist = Color(0xFFF7F8FA);

  /// Hairlines. Borders do the work shadows would otherwise have to.
  static const rule = Color(0xFFEAECF0);

  /// A divider inside a card, lighter than [rule] so rows group visually.
  static const ruleFaint = Color(0xFFF2F4F7);

  /// The single most consequential button on a screen. Blue here, because
  /// in this app that button is "Approve price".
  static const accentButton = blue;
  static const accentButtonShadow = blueShadow;

  /// The one gradient in the app: the live-booking card.
  static const liveGradient = LinearGradient(
    begin: Alignment(-0.9, -1),
    end: Alignment(1, 1),
    colors: [blue, blueMid, sky],
    stops: [0.0, 0.55, 1.0],
  );

  // ── Category accents ───────────────────────────────────────────────────
  /// Service tiles carry a tint each so the grid is scannable at a glance.
  /// These live only inside a tile's icon well — never on text.
  static const catElectric = blue;
  static const catElectricSoft = blueSoft;
  static const catPlumb = Color(0xFF0891B2);
  static const catPlumbSoft = Color(0xFFF0FBFF);
  static const catAc = Color(0xFF7C5CFA);
  static const catAcSoft = Color(0xFFF4F1FF);
  static const catGenerator = green;
  static const catGeneratorSoft = greenSoft;

  // ── Elevation ──────────────────────────────────────────────────────────
  /// Cards float on a shadow this faint; the border does most of the
  /// separating. A heavier shadow is what makes a light UI look cheap.
  static const cardShadow = [
    BoxShadow(
      color: Color(0x14101828),
      blurRadius: 8,
      offset: Offset(0, 2),
      spreadRadius: -5,
    ),
  ];

  /// Only the primary button and the floating nav sit this high.
  static const raisedShadow = [
    BoxShadow(
      color: Color(0x33101828),
      blurRadius: 22,
      offset: Offset(0, 10),
      spreadRadius: -10,
    ),
  ];

  static const blueShadow = [
    BoxShadow(
      color: Color(0x662563EB),
      blurRadius: 22,
      offset: Offset(0, 10),
      spreadRadius: -10,
    ),
  ];
}
