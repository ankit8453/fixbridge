import 'provider.dart';

/// One input to the trust score.
class TrustComponent {
  const TrustComponent({
    required this.name,
    required this.label,
    required this.reason,
    required this.normalized,
    required this.weight,
    required this.contribution,
    required this.pending,
  });

  /// `rating`, `acceptance`, `reliability`, `complaints` or `recency`.
  final String name;

  /// Already localised by the server — display it, don't rebuild it.
  final String label;
  final String reason;

  /// 0..1, or null when there is not enough history to say.
  final double? normalized;

  final double weight;
  final double contribution;

  /// True when `normalized` is null. Greyed out rather than shown as zero —
  /// "not enough jobs yet" and "you scored nothing" are different messages.
  final bool pending;

  factory TrustComponent.fromJson(Map<String, dynamic> json) => TrustComponent(
        name: json['name'] as String? ?? '',
        label: json['label'] as String? ?? '',
        reason: json['reason'] as String? ?? '',
        normalized: (json['normalized'] as num?)?.toDouble(),
        weight: (json['weight'] as num?)?.toDouble() ?? 0,
        contribution: (json['contribution'] as num?)?.toDouble() ?? 0,
        pending: json['pending'] as bool? ?? false,
      );
}

/// What the next badge needs.
///
/// **The meaning of [needsScore] changes.** When the technician has no score
/// yet it is an absolute target; otherwise it is the remaining gap. The API
/// does this because there is nothing to subtract from at the start, and a
/// client that treats it as a gap either way shows nonsense on day one.
class NextBand {
  const NextBand({
    required this.band,
    required this.needsScore,
    required this.needsJobs,
    required this.isAbsolute,
  });

  final String band;
  final double needsScore;
  final int needsJobs;

  /// True when there is no score yet, so the numbers are targets not gaps.
  final bool isAbsolute;

  static NextBand? fromJson(Map<String, dynamic>? json,
      {required bool hasScore}) {
    if (json == null) return null;
    return NextBand(
      band: json['band'] as String? ?? 'SILVER',
      needsScore: (json['needsScore'] as num?)?.toDouble() ?? 0,
      needsJobs: (json['needsJobs'] as num?)?.toInt() ?? 0,
      isAbsolute: !hasScore,
    );
  }
}

/// A past score, for the trend line.
class TrustSnapshot {
  const TrustSnapshot({
    required this.score,
    required this.badge,
    required this.at,
  });

  final double score;
  final String badge;
  final DateTime at;

  factory TrustSnapshot.fromJson(Map<String, dynamic> json) => TrustSnapshot(
        score: (json['score'] as num?)?.toDouble() ?? 0,
        badge: json['badge'] as String? ?? 'NONE',
        at: DateTime.tryParse(json['at'] as String? ?? '')?.toLocal() ??
            DateTime.now(),
      );
}

/// The technician's standing, computed live rather than read from the last
/// snapshot — the question is about where they are now.
class Trust {
  const Trust({
    required this.score,
    required this.badge,
    required this.settledJobs,
    required this.components,
    required this.nextBand,
    required this.suspendedUntil,
    required this.suspensionReason,
    required this.trend,
  });

  /// Null means no history yet — **not** zero. Rendering a null as 0 tells
  /// somebody they have failed when they have simply not started.
  final double? score;

  final TrustBadge badge;
  final int settledJobs;
  final List<TrustComponent> components;
  final NextBand? nextBand;

  /// Set while suspended. A suspended technician is filtered out of search
  /// entirely, so this has to be impossible to miss on screen.
  final DateTime? suspendedUntil;
  final String? suspensionReason;

  final List<TrustSnapshot> trend;

  bool get isSuspended =>
      suspendedUntil != null && suspendedUntil!.isAfter(DateTime.now());

  factory Trust.fromJson(Map<String, dynamic> json) {
    final score = (json['score'] as num?)?.toDouble();

    return Trust(
      score: score,
      badge: TrustBadge.parse(json['badge'] as String?),
      settledJobs: (json['settledJobs'] as num?)?.toInt() ?? 0,
      components: (json['components'] as List?)
              ?.map((c) =>
                  TrustComponent.fromJson((c as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      nextBand: NextBand.fromJson(
        (json['nextBand'] as Map?)?.cast<String, dynamic>(),
        hasScore: score != null,
      ),
      suspendedUntil:
          DateTime.tryParse(json['suspendedUntil'] as String? ?? '')?.toLocal(),
      suspensionReason: json['suspensionReason'] as String?,
      trend: (json['trend'] as List?)
              ?.map((t) =>
                  TrustSnapshot.fromJson((t as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
    );
  }
}
