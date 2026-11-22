/// Where one person stands on one legal document, as `GET /legal/me` and
/// `POST /legal/accept` return it.
///
/// Parsed defensively on purpose. This decides whether somebody may use the
/// app at all, so a field that is missing or the wrong type must never crash
/// the screen — and must never read as "accepted" either. Only a literal
/// `true` counts.
class LegalDocStatus {
  const LegalDocStatus({
    required this.currentVersion,
    required this.acceptedVersion,
    required this.acceptedAt,
    required this.accepted,
  });

  /// The version in force now — what the screen shows and what gets posted
  /// back on accept. Null when the API did not say, which the app treats as
  /// "cannot be accepted yet" rather than guessing.
  final String? currentVersion;

  /// The version this person last accepted, possibly an older one.
  final String? acceptedVersion;

  /// ISO timestamp of that acceptance, kept as the API sent it.
  final String? acceptedAt;

  /// True only when the *current* version is accepted.
  final bool accepted;

  static const empty = LegalDocStatus(
    currentVersion: null,
    acceptedVersion: null,
    acceptedAt: null,
    accepted: false,
  );

  factory LegalDocStatus.fromJson(Object? json) {
    if (json is! Map) return empty;
    return LegalDocStatus(
      currentVersion: _string(json['currentVersion']),
      acceptedVersion: _string(json['acceptedVersion']),
      acceptedAt: _string(json['acceptedAt']),
      accepted: json['accepted'] == true,
    );
  }

  static String? _string(Object? value) {
    if (value is! String) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}

/// Both documents. This app only ever acts on [partnerTerms]; the customer
/// side is parsed because it comes in the same body, not because it is used.
class LegalStatus {
  const LegalStatus({required this.customerTerms, required this.partnerTerms});

  final LegalDocStatus customerTerms;
  final LegalDocStatus partnerTerms;

  static const empty = LegalStatus(
    customerTerms: LegalDocStatus.empty,
    partnerTerms: LegalDocStatus.empty,
  );

  factory LegalStatus.fromJson(Object? json) {
    if (json is! Map) return empty;
    return LegalStatus(
      customerTerms: LegalDocStatus.fromJson(json['customerTerms']),
      partnerTerms: LegalDocStatus.fromJson(json['partnerTerms']),
    );
  }
}
