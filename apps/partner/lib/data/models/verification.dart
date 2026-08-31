/// A file uploaded for verification.
class VerificationDocument {
  const VerificationDocument({
    required this.id,
    required this.docType,
    required this.status,
    required this.contentType,
    required this.sizeBytes,
    required this.uploadedAt,
  });

  final String id;

  /// `id_proof`, `certificate`, `photo` or `other`.
  ///
  /// A `photo` here is the KYC portrait that satisfies the profile's
  /// `photoDocument` completeness item — **not** the profile picture, which
  /// is a different endpoint entirely and scores nothing.
  final String docType;

  /// `pending`, `uploaded`, `verified` or `rejected`.
  final String status;

  final String contentType;
  final int sizeBytes;
  final DateTime? uploadedAt;

  bool get isReady => status == 'uploaded' || status == 'verified';

  factory VerificationDocument.fromJson(Map<String, dynamic> json) =>
      VerificationDocument(
        id: json['id'] as String? ?? '',
        docType: json['docType'] as String? ?? 'other',
        status: json['status'] as String? ?? 'pending',
        contentType: json['contentType'] as String? ?? '',
        sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
        uploadedAt:
            DateTime.tryParse(json['uploadedAt'] as String? ?? '')?.toLocal(),
      );
}

/// Where to PUT the bytes.
class UploadTarget {
  const UploadTarget({
    required this.documentId,
    required this.url,
    required this.headers,
  });

  final String documentId;
  final String url;

  /// Must be sent verbatim — the size and content type are signed into the
  /// URL, so storage rejects anything that does not match.
  final Map<String, String> headers;

  factory UploadTarget.fromJson(Map<String, dynamic> json) {
    final upload = (json['upload'] as Map?)?.cast<String, dynamic>();
    final document = (json['document'] as Map?)?.cast<String, dynamic>();

    return UploadTarget(
      documentId: document?['id'] as String? ?? '',
      url: upload?['url'] as String? ?? '',
      // `requiredHeaders`, not `headers` — the name matters because these are
      // signed into the URL, and sending none makes storage reject the PUT.
      headers: (upload?['requiredHeaders'] as Map?)?.map(
            (k, v) => MapEntry(k as String, v.toString()),
          ) ??
          const {},
    );
  }
}

/// One verification case, per level.
class VerificationCase {
  const VerificationCase({
    required this.id,
    required this.level,
    required this.levelName,
    required this.status,
    required this.openedAt,
    required this.closedAt,
  });

  final String id;

  /// 0, 1 or 2.
  final int level;

  final String levelName;

  /// `submitted`, `in_review`, `needs_info`, `passed` or `failed`.
  final String status;

  final DateTime openedAt;
  final DateTime? closedAt;

  bool get isPassed => status == 'passed';
  bool get isFailed => status == 'failed';
  bool get needsInfo => status == 'needs_info';
  bool get isOpen => !isPassed && !isFailed;

  factory VerificationCase.fromJson(Map<String, dynamic> json) =>
      VerificationCase(
        id: json['id'] as String? ?? '',
        level: (json['level'] as num?)?.toInt() ?? 0,
        levelName: json['levelName'] as String? ?? '',
        status: json['status'] as String? ?? 'submitted',
        openedAt:
            DateTime.tryParse(json['openedAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
        closedAt:
            DateTime.tryParse(json['closedAt'] as String? ?? '')?.toLocal(),
      );
}

/// The three levels, and what each one is for.
///
/// Level 3 (references) was retired — requiring two contactable referees gated
/// the badge on a social fact rather than on somebody's work. The numbers are
/// deliberately **not** renumbered, because the append-only event log refers
/// to them; 3 simply stops being asked for.
abstract final class VerificationLevels {
  const VerificationLevels._();

  static const all = [0, 1, 2];

  static const titles = <int, String>{
    0: 'Prove who you are',
    1: 'Background check',
    2: 'Prove your skill',
  };

  static const blurbs = <int, String>{
    0: 'An ID document and a photo of yourself. We only keep the last four '
        'digits of the number — never the whole thing.',
    1: 'Your permission for us to run a standard check. Nothing to upload.',
    2: 'A certificate, or ask us to arrange a trade test.',
  };

  static const idTypes = <String, String>{
    'aadhaar': 'Aadhaar',
    'pan': 'PAN',
    'dl': 'Driving licence',
    'voter': 'Voter ID',
  };
}

/// Verification progress, as `GET /verification/cases` returns it.
class VerificationSummary {
  const VerificationSummary({
    required this.badge,
    required this.levelsPassed,
    required this.cases,
  });

  final String badge;
  final List<int> levelsPassed;
  final List<VerificationCase> cases;

  /// Derived here rather than read from the response.
  ///
  /// The API used to report `[0,1,2,3]` for a brand-new technician, offering a
  /// level whose submission answers 400. That is fixed server-side, but this
  /// stays derived: an app already on someone's phone cannot be corrected by
  /// deploying the API, and the retired level must never reappear in the UI.
  List<int> get levelsRemaining =>
      VerificationLevels.all.where((l) => !levelsPassed.contains(l)).toList();

  bool get isVerified => levelsPassed.length == VerificationLevels.all.length;

  /// The open case for a level, if there is one.
  VerificationCase? caseFor(int level) {
    for (final c in cases) {
      if (c.level == level && c.isOpen) return c;
    }
    for (final c in cases) {
      if (c.level == level) return c;
    }
    return null;
  }

  factory VerificationSummary.fromJson(Map<String, dynamic> json) {
    final summary = (json['summary'] as Map?)?.cast<String, dynamic>();

    return VerificationSummary(
      badge: summary?['badge'] as String? ?? 'NONE',
      levelsPassed: (summary?['levelsPassed'] as List?)
              ?.whereType<num>()
              .map((l) => l.toInt())
              .toList() ??
          const [],
      cases: (json['cases'] as List?)
              ?.map((c) =>
                  VerificationCase.fromJson((c as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
    );
  }
}
