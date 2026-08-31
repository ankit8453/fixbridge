import 'package:flutter/material.dart';

/// The partner app's palette.
///
/// **Graphite, deliberately.** The customer app spends one blue on everything
/// interactive. This app cannot afford that, because a technician's screen has
/// three things that must be told apart in a glance, between jobs, outdoors:
///
///   * **green** — money earned, and the button that earns it
///   * **amber** — the acceptance countdown, and a charge needing a reason
///   * **red** — suspended, declined, locked out
///
/// If the brand took any of those hues, that meaning would have to be carried
/// some other way. So the chrome here has no opinion: graphite is the frame,
/// and every colour inside it means something. It is also unmistakably not the
/// customer app, which matters because one person may hold both roles.
abstract final class AppColors {
  const AppColors._();

  // ── The frame ──────────────────────────────────────────────────────────
  /// Headers, primary chrome, the nav. 9.7:1 on the ground.
  static const graphite = Color(0xFF334155);
  static const graphiteDeep = Color(0xFF1E293B);
  static const graphiteMid = Color(0xFF64748B);
  static const graphiteSoft = Color(0xFFF1F5F9);

  /// Body text.
  static const ink = Color(0xFF0B0C0F);
  static const inkMuted = Color(0xFF475467);

  /// Metadata. 5.3:1 — still AA.
  static const grey = Color(0xFF667085);

  /// Placeholders only. Below AA on purpose.
  static const greyLight = Color(0xFF98A2B3);

  // ── Meaning ────────────────────────────────────────────────────────────
  /// Money earned, accept, verified, paid. The loudest colour in the app,
  /// because earning is what a technician opens it for.
  static const green = Color(0xFF12B76A);
  static const greenSoft = Color(0xFFECFDF3);
  static const greenDeep = Color(0xFF027A48);

  /// The acceptance countdown, and any charge that needs justifying.
  static const amber = Color(0xFFB45309);
  static const amberSoft = Color(0xFFFFFAEB);
  static const amberLine = Color(0xFFFEDF89);

  /// The name the shared widgets use for the same colour.
  static const amberText = amber;

  /// Suspended, declined, locked. Nothing else is ever this colour, so it
  /// always lands.
  static const red = Color(0xFFD92D20);
  static const redSoft = Color(0xFFFEF3F2);
  static const redLine = Color(0xFFFECDCA);

  // ── Surfaces ───────────────────────────────────────────────────────────
  static const ground = Color(0xFFFBFBFD);
  static const surface = Color(0xFFFFFFFF);
  static const mist = Color(0xFFF7F8FA);
  static const rule = Color(0xFFEAECF0);
  static const ruleFaint = Color(0xFFF2F4F7);

  /// The earnings header — the one gradient in the app, on the one number a
  /// technician actually opens it to see.
  static const earningsGradient = LinearGradient(
    begin: Alignment(-0.9, -1),
    end: Alignment(1, 1),
    colors: [graphiteDeep, graphite, graphiteMid],
    stops: [0.0, 0.58, 1.0],
  );

  // ── Shared-widget aliases ──────────────────────────────────────────────
  //
  // The buttons, cards and fields are shared verbatim with the customer app,
  // where the accent is called `blue`. Aliasing here rather than renaming
  // every call site keeps those files byte-identical between the two apps, so
  // a fix in one is a fix in both. Only the values differ.
  static const blue = graphite;

  /// The single most consequential button on a screen. Green here, because
  /// in this app that button is "Accept job" — money arriving.
  static const accentButton = green;
  static const accentButtonShadow = goShadow;
  static const blueSoft = graphiteSoft;

  /// What the customer app calls a "live" gradient; here it is the earnings
  /// header, which is the equivalent moment — the one thing worth a gradient.
  static const liveGradient = earningsGradient;

  // ── Elevation ──────────────────────────────────────────────────────────
  static const cardShadow = [
    BoxShadow(
      color: Color(0x14101828),
      blurRadius: 8,
      offset: Offset(0, 2),
      spreadRadius: -5,
    ),
  ];

  static const raisedShadow = [
    BoxShadow(
      color: Color(0x33101828),
      blurRadius: 22,
      offset: Offset(0, 10),
      spreadRadius: -10,
    ),
  ];

  /// Under the accept button, and nowhere else.
  static const goShadow = [
    BoxShadow(
      color: Color(0xBF12B76A),
      blurRadius: 20,
      offset: Offset(0, 9),
      spreadRadius: -10,
    ),
  ];

  /// The shared AppButton's `accent` variant. In the customer app that is the
  /// blue "approve" button; here it is the green "accept job" one, which is
  /// the same role — the single most consequential tap on the screen.
  static const blueShadow = goShadow;
}
