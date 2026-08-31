import 'money.dart';

/// The trust badge a technician has earned.
enum TrustBadge {
  none,
  verified,
  silver,
  gold;

  static TrustBadge parse(String? raw) => switch (raw?.toUpperCase()) {
        'VERIFIED' => TrustBadge.verified,
        'SILVER' => TrustBadge.silver,
        'GOLD' => TrustBadge.gold,
        _ => TrustBadge.none,
      };

  bool get isEarned => this != TrustBadge.none;
}

/// A star rating, or the deliberate absence of one.
///
/// The API sends `null` until somebody has actually rated this person — never
/// a fabricated 0.0 or 5.0. The UI must show that as "New", which reads as a
/// fact rather than as a failing.
class Rating {
  const Rating({required this.average, required this.count});

  final double average;
  final int count;

  static Rating? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return Rating(
      average: (json['average'] as num?)?.toDouble() ?? 0,
      count: (json['count'] as num?)?.toInt() ?? 0,
    );
  }
}

/// A skill on a profile or a search card.
class ProviderSkill {
  const ProviderSkill({
    required this.categoryId,
    required this.slug,
    required this.name,
  });

  final int categoryId;
  final String slug;
  final String name;

  factory ProviderSkill.fromJson(Map<String, dynamic> json) => ProviderSkill(
        categoryId: (json['categoryId'] as num).toInt(),
        slug: json['slug'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );
}

/// An hours-of-the-week window.
class AvailabilityWindow {
  const AvailabilityWindow({
    required this.dayOfWeek,
    required this.startTime,
    required this.endTime,
  });

  /// 0 = Sunday.
  final int dayOfWeek;

  /// `HH:MM`, 24-hour.
  final String startTime;
  final String endTime;

  static AvailabilityWindow? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return AvailabilityWindow(
      dayOfWeek: (json['dayOfWeek'] as num?)?.toInt() ?? 0,
      startTime: json['startTime'] as String? ?? '',
      endTime: json['endTime'] as String? ?? '',
    );
  }
}

/// One result card from `GET /search/providers`.
///
/// Note what is deliberately absent: exact coordinates and a phone number.
/// [distanceKm] is rounded to 0.1 km — too coarse to triangulate a home from
/// — and [locality] is a human area name, never a point.
class ProviderCard {
  const ProviderCard({
    required this.providerId,
    required this.displayName,
    required this.badge,
    required this.rating,
    required this.jobsCompleted,
    required this.yearsExperience,
    required this.distanceKm,
    required this.skills,
    required this.startingPricePaise,
    required this.startingPriceDisplay,
    required this.nextAvailability,
    required this.locality,
  });

  final String providerId;
  final String? displayName;
  final TrustBadge badge;

  /// Null until rated. Show "New", not a zero.
  final Rating? rating;

  final int jobsCompleted;
  final int? yearsExperience;
  final double distanceKm;
  final List<ProviderSkill> skills;
  final int? startingPricePaise;
  final String? startingPriceDisplay;
  final AvailabilityWindow? nextAvailability;
  final String? locality;

  String get name => displayName ?? 'Technician';

  String get priceLabel => startingPricePaise == null
      ? '—'
      : Paise.show(startingPriceDisplay, startingPricePaise);

  factory ProviderCard.fromJson(Map<String, dynamic> json) {
    final price = json['startingPrice'] as Map?;
    return ProviderCard(
      providerId: json['providerId'] as String,
      displayName: json['displayName'] as String?,
      badge: TrustBadge.parse(json['badge'] as String?),
      rating:
          Rating.fromJson((json['rating'] as Map?)?.cast<String, dynamic>()),
      jobsCompleted: (json['jobsCompleted'] as num?)?.toInt() ?? 0,
      yearsExperience: (json['yearsExperience'] as num?)?.toInt(),
      distanceKm: (json['distanceKm'] as num?)?.toDouble() ?? 0,
      skills: (json['skills'] as List?)
              ?.map((s) =>
                  ProviderSkill.fromJson((s as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      startingPricePaise: asPaiseOrNull(price?['amountPaise']),
      startingPriceDisplay: price?['display'] as String?,
      nextAvailability: AvailabilityWindow.fromJson(
        (json['nextAvailability'] as Map?)?.cast<String, dynamic>(),
      ),
      locality: json['locality'] as String?,
    );
  }
}

/// A price card on a public profile. Only `fixed` is written any more; the
/// other two types survive on historical rows and frozen booking snapshots.
class PriceCard {
  const PriceCard({
    required this.id,
    required this.categoryId,
    required this.title,
    required this.priceType,
    required this.amountPaise,
    required this.display,
  });

  final String id;
  final int categoryId;
  final String title;
  final String priceType;
  final int? amountPaise;
  final String? display;

  bool get isFixed => priceType == 'fixed';

  factory PriceCard.fromJson(Map<String, dynamic> json) => PriceCard(
        id: json['id'] as String,
        categoryId: (json['categoryId'] as num).toInt(),
        title: json['title'] as String? ?? '',
        priceType: json['priceType'] as String? ?? 'fixed',
        amountPaise: asPaiseOrNull(json['amountPaise']),
        display: json['display'] as String?,
      );
}

/// The full public profile from `GET /providers/:id`.
///
/// A 404 here is deliberately uniform across "does not exist", "not listed"
/// and "suspended", so the endpoint cannot be used to discover that somebody
/// was suspended. The copy must match that: "not available right now".
class ProviderProfile {
  const ProviderProfile({
    required this.providerId,
    required this.displayName,
    required this.badge,
    required this.bio,
    required this.yearsExperience,
    required this.cityName,
    required this.rating,
    required this.jobsCompleted,
    required this.tagCounts,
    required this.skills,
    required this.priceCards,
    required this.memberSince,
  });

  final String providerId;
  final String? displayName;
  final TrustBadge badge;
  final String? bio;
  final int? yearsExperience;

  /// City granularity only. No locality, no coordinates.
  final String? cityName;

  final Rating? rating;
  final int jobsCompleted;

  /// How often each review tag was chosen — "punctual: 24".
  final Map<String, int> tagCounts;

  final List<ProviderSkill> skills;
  final List<PriceCard> priceCards;
  final DateTime? memberSince;

  String get name => displayName ?? 'Technician';

  factory ProviderProfile.fromJson(Map<String, dynamic> json) {
    final city = json['city'] as Map?;
    return ProviderProfile(
      providerId: json['providerId'] as String,
      displayName: json['displayName'] as String?,
      badge: TrustBadge.parse(json['badge'] as String?),
      bio: json['bio'] as String?,
      yearsExperience: (json['yearsExperience'] as num?)?.toInt(),
      cityName: city?['name'] as String?,
      rating:
          Rating.fromJson((json['rating'] as Map?)?.cast<String, dynamic>()),
      jobsCompleted: (json['jobsCompleted'] as num?)?.toInt() ?? 0,
      tagCounts: (json['tagCounts'] as Map?)?.map(
            (k, v) => MapEntry(k as String, (v as num).toInt()),
          ) ??
          const {},
      skills: (json['skills'] as List?)
              ?.map((s) => ProviderSkill(
                    categoryId: ((s as Map)['categoryId'] as num).toInt(),
                    slug: s['slug'] as String? ?? '',
                    // The public profile sends nameKey rather than a resolved
                    // name; the slug is the readable fallback.
                    name: s['name'] as String? ?? s['slug'] as String? ?? '',
                  ))
              .toList() ??
          const [],
      priceCards: (json['priceCards'] as List?)
              ?.map(
                  (p) => PriceCard.fromJson((p as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      memberSince: DateTime.tryParse(json['memberSince'] as String? ?? ''),
    );
  }
}

/// A bookable hour from `GET /providers/:id/slots`.
///
/// Only `open` slots come back. Which hours are already booked, and when the
/// technician took an afternoon off, is nobody else's business.
class ProviderSlot {
  const ProviderSlot({
    required this.id,
    required this.startsAt,
    required this.endsAt,
  });

  final String id;
  final DateTime startsAt;
  final DateTime endsAt;

  factory ProviderSlot.fromJson(Map<String, dynamic> json) => ProviderSlot(
        id: json['id'] as String,
        startsAt: DateTime.parse(json['startsAt'] as String).toLocal(),
        endsAt: DateTime.parse(json['endsAt'] as String).toLocal(),
      );
}

/// A published customer→provider review.
class ProviderReview {
  const ProviderReview({
    required this.id,
    required this.stars,
    required this.tags,
    required this.text,
    required this.authorName,
    required this.createdAt,
  });

  final String id;
  final int stars;
  final List<String> tags;
  final String? text;

  /// First name and an initial only — a full name here would be a real
  /// safety problem for the person who wrote it.
  final String authorName;

  final DateTime createdAt;

  factory ProviderReview.fromJson(Map<String, dynamic> json) => ProviderReview(
        id: json['id'] as String,
        stars: (json['stars'] as num?)?.toInt() ?? 0,
        tags: (json['tags'] as List?)?.map((t) => t as String).toList() ??
            const [],
        text: json['text'] as String?,
        authorName: json['authorName'] as String? ?? '',
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
      );
}
