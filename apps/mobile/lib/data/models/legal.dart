/// Where somebody stands on one legal document, as `GET /legal/me` reports it.
///
/// Parsed defensively on purpose. This object decides whether the app lets
/// somebody in, so a field that is missing or the wrong type must land on the
/// safe side — **not accepted** — rather than throw and leave the screen
/// blank, and never on the side of waving somebody through.
class LegalDocStatus {
  const LegalDocStatus({
    required this.currentVersion,
    required this.acceptedVersion,
    required this.acceptedAt,
    required this.accepted,
  });

  /// The version in force now — the one the screen shows and sends back when
  /// the box is ticked. Empty when the server did not say, which leaves the
  /// accept button with nothing to send; see [canAccept].
  final String currentVersion;

  /// The last version this person accepted, if any. May be older than
  /// [currentVersion].
  final String? acceptedVersion;

  /// When they accepted it. Kept as the server's own string — it is only
  /// ever displayed or passed on, never compared.
  final String? acceptedAt;

  /// True only when [currentVersion] itself has been accepted. Taken from the
  /// server rather than re-derived by comparing versions here, so the rule
  /// lives in one place.
  final bool accepted;

  /// Nothing to accept without a version to name.
  bool get canAccept => currentVersion.isNotEmpty;

  static const unknown = LegalDocStatus(
    currentVersion: '',
    acceptedVersion: null,
    acceptedAt: null,
    accepted: false,
  );

  factory LegalDocStatus.fromJson(Object? raw) {
    if (raw is! Map) return unknown;
    final json = raw.cast<String, dynamic>();

    return LegalDocStatus(
      currentVersion: _string(json['currentVersion']) ?? '',
      acceptedVersion: _string(json['acceptedVersion']),
      acceptedAt: _string(json['acceptedAt']),
      // Exactly `true`, nothing looser: a missing flag, a null, or a stray
      // "true" string must not count as consent.
      accepted: json['accepted'] == true,
    );
  }

  static String? _string(Object? value) {
    if (value is String && value.isNotEmpty) return value;
    return null;
  }
}

/// The whole `GET /legal/me` / `POST /legal/accept` body.
///
/// The API answers for both documents; this app only acts on
/// [customerTerms]. [partnerTerms] is parsed so the shape is complete, not
/// because anything here reads it.
class LegalStatus {
  const LegalStatus({
    required this.customerTerms,
    required this.partnerTerms,
  });

  final LegalDocStatus customerTerms;
  final LegalDocStatus partnerTerms;

  factory LegalStatus.fromJson(Object? raw) {
    final json = raw is Map ? raw.cast<String, dynamic>() : const <String, dynamic>{};
    return LegalStatus(
      customerTerms: LegalDocStatus.fromJson(json['customerTerms']),
      partnerTerms: LegalDocStatus.fromJson(json['partnerTerms']),
    );
  }
}
