import 'money.dart';
import 'provider.dart';

/// One item the profile is still missing, or has satisfied.
///
/// The API sends these as **plain strings** — `"displayName"`, `"skills"` —
/// not objects. Wrapping them here keeps the label logic in one place without
/// pretending the wire format is richer than it is.
class CompletenessItem {
  const CompletenessItem(this.key);

  /// `baseLocation`, `skills`, `priceCard`, `availability`, `displayName`,
  /// `photoDocument`, `bio`, `yearsExperience`.
  final String key;

  /// What a technician should read, not what the field is called.
  String get label => switch (key) {
        'baseLocation' => 'Where you work from',
        'skills' => 'What you do',
        'priceCard' => 'Your prices',
        'availability' => 'When you work',
        'displayName' => 'Your name',
        // Deliberately explicit: this is a KYC document with docType 'photo',
        // NOT the profile picture. Uploading a profile photo does not satisfy
        // it, and a vaguer label sends people to the wrong screen.
        'photoDocument' => 'A photo of yourself (ID document)',
        'bio' => 'A line about yourself',
        'yearsExperience' => 'Years of experience',
        _ => key,
      };
}

/// How close the profile is to being listed.
class Completeness {
  const Completeness({
    required this.score,
    required this.threshold,
    required this.isListed,
    required this.missing,
    required this.missingRequired,
  });

  final int score;
  final int threshold;
  final bool isListed;

  final List<CompletenessItem> missing;

  /// Empty means good to go. **This is what an onboarding screen counts down
  /// to** — the score is a secondary quality bar, and satisfying the five
  /// required items already reaches 90 against a default threshold of 80.
  final List<CompletenessItem> missingRequired;

  factory Completeness.fromJson(Map<String, dynamic>? json) => Completeness(
        score: (json?['score'] as num?)?.toInt() ?? 0,
        threshold: (json?['threshold'] as num?)?.toInt() ?? 80,
        isListed: json?['isListed'] as bool? ?? false,
        missing: _items(json?['missing']),
        missingRequired: _items(json?['missingRequired']),
      );

  /// Tolerant of both shapes.
  ///
  /// The API sends plain strings — `"displayName"` — and reading them as
  /// objects is what was crashing the profile screen. Accepting an object's
  /// `key` as well costs nothing, and means a later server change to a richer
  /// shape cannot break the one screen a technician needs to start earning.
  static List<CompletenessItem> _items(Object? raw) {
    if (raw is! List) return const [];
    return raw
        .map(
          (item) => CompletenessItem(
            item is Map ? item['key'] as String? ?? '' : item.toString(),
          ),
        )
        .where((item) => item.key.isNotEmpty)
        .toList();
  }
}

/// A point on the map.
class GeoPoint {
  const GeoPoint(this.lat, this.lng);

  final double lat;
  final double lng;

  /// Null in, null out — an absent base location is the normal state for a
  /// technician who has not set one yet, not a parse failure.
  static GeoPoint? fromJson(Map<String, dynamic>? json) {
    final lat = (json?['lat'] as num?)?.toDouble();
    final lng = (json?['lng'] as num?)?.toDouble();
    if (lat == null || lng == null) return null;
    return GeoPoint(lat, lng);
  }
}

/// A skill on the technician's own profile.
class OwnSkill {
  const OwnSkill({
    required this.categoryId,
    required this.categorySlug,
    required this.categoryName,
    required this.experienceNote,
  });

  final int categoryId;
  final String categorySlug;
  final String categoryName;
  final String? experienceNote;

  factory OwnSkill.fromJson(Map<String, dynamic> json) => OwnSkill(
        categoryId: (json['categoryId'] as num?)?.toInt() ?? 0,
        categorySlug: json['categorySlug'] as String? ?? '',
        categoryName: json['categoryName'] as String? ?? '',
        experienceNote: json['experienceNote'] as String?,
      );
}

/// A price the technician has set.
class OwnPriceCard {
  const OwnPriceCard({
    required this.id,
    required this.categoryId,
    required this.categoryName,
    required this.title,
    required this.priceType,
    required this.amountPaise,
    required this.isActive,
  });

  final String id;
  final int categoryId;
  final String categoryName;
  final String title;

  /// Only `fixed` can be written now. The other two survive on historical
  /// rows and frozen booking snapshots.
  final String priceType;

  final int? amountPaise;
  final bool isActive;

  String get display => amountPaise == null ? '—' : Paise.format(amountPaise!);

  factory OwnPriceCard.fromJson(Map<String, dynamic> json) => OwnPriceCard(
        id: json['id'] as String? ?? '',
        categoryId: (json['categoryId'] as num?)?.toInt() ?? 0,
        categoryName: json['categoryName'] as String? ?? '',
        title: json['title'] as String? ?? '',
        priceType: json['priceType'] as String? ?? 'fixed',
        amountPaise: asPaiseOrNull(json['amountPaise']),
        isActive: json['isActive'] as bool? ?? true,
      );
}

/// A weekly working window.
class OwnAvailability {
  const OwnAvailability({
    required this.id,
    required this.dayOfWeek,
    required this.startTime,
    required this.endTime,
    required this.isActive,
  });

  final String id;

  /// 0 = Sunday.
  final int dayOfWeek;

  /// `HH:MM`, 24-hour, **as a string in both directions** — never minutes.
  final String startTime;
  final String endTime;

  final bool isActive;

  String get dayName => switch (dayOfWeek) {
        0 => 'Sunday',
        1 => 'Monday',
        2 => 'Tuesday',
        3 => 'Wednesday',
        4 => 'Thursday',
        5 => 'Friday',
        _ => 'Saturday',
      };

  factory OwnAvailability.fromJson(Map<String, dynamic> json) =>
      OwnAvailability(
        id: json['id'] as String? ?? '',
        dayOfWeek: (json['dayOfWeek'] as num?)?.toInt() ?? 0,
        startTime: json['startTime'] as String? ?? '',
        endTime: json['endTime'] as String? ?? '',
        isActive: json['isActive'] as bool? ?? true,
      );
}

/// A slot as the technician sees it.
///
/// Distinct from the public `ProviderSlot`, which returns only open hours with
/// no status: which hours are booked and when somebody took an afternoon off
/// is deliberately not published, so the two views are different endpoints and
/// different shapes rather than one with a flag.
class OwnSlot {
  const OwnSlot({
    required this.id,
    required this.startsAt,
    required this.endsAt,
    required this.status,
    required this.bookingId,
  });

  final String id;
  final DateTime startsAt;
  final DateTime endsAt;

  /// `open`, `booked` or `blocked`.
  final String status;

  /// Non-null only when booked — lets the week view link to the job.
  final String? bookingId;

  bool get isBooked => status == 'booked';
  bool get isBlocked => status == 'blocked';

  factory OwnSlot.fromJson(Map<String, dynamic> json) => OwnSlot(
        id: json['id'] as String? ?? '',
        startsAt: asDate(json['startsAt']),
        endsAt: asDate(json['endsAt']),
        status: json['status'] as String? ?? 'open',
        bookingId: json['bookingId'] as String?,
      );
}

/// The technician's own profile, as `GET /providers/me` returns it.
class PartnerProfile {
  const PartnerProfile({
    required this.userId,
    required this.displayName,
    required this.bio,
    required this.yearsExperience,
    required this.cityId,
    required this.baseLocation,
    required this.serviceRadiusKm,
    required this.isListed,
    required this.badge,
    required this.levelsPassed,
    required this.completeness,
    required this.skills,
    required this.priceCards,
    required this.availability,
  });

  final String userId;
  final String? displayName;
  final String? bio;
  final int? yearsExperience;
  final int cityId;

  /// Where they work from. **Null until they set it, and one of the five
  /// required items** — without it nobody can be matched to them, so a
  /// profile with no base location can never be listed however complete the
  /// rest of it is.
  final GeoPoint? baseLocation;

  final int serviceRadiusKm;

  /// Whether the profile is complete enough to be *findable*. Independent of
  /// [badge] — search requires both, and conflating them is why a technician
  /// at 100% with pending verification wonders where the jobs are.
  final bool isListed;

  /// `VERIFIED` only when levels 0, 1 and 2 have all passed.
  final TrustBadge badge;

  final List<int> levelsPassed;
  final Completeness completeness;
  final List<OwnSkill> skills;
  final List<OwnPriceCard> priceCards;
  final List<OwnAvailability> availability;

  /// Never empty — the avatar takes its first character, and a name that is
  /// null or only whitespace would otherwise crash the screen rather than
  /// looking untidy.
  String get name {
    final trimmed = displayName?.trim() ?? '';
    return trimmed.isEmpty ? 'Your profile' : trimmed;
  }

  /// Both gates cleared. Until this is true, no customer can find them.
  bool get canReceiveWork => isListed && badge.isEarned;

  factory PartnerProfile.fromJson(Map<String, dynamic> json) {
    final verification = json['verification'] as Map?;

    return PartnerProfile(
      userId: json['userId'] as String? ?? '',
      displayName: json['displayName'] as String?,
      bio: json['bio'] as String?,
      yearsExperience: (json['yearsExperience'] as num?)?.toInt(),
      cityId: (json['cityId'] as num?)?.toInt() ?? 0,
      baseLocation: GeoPoint.fromJson(
          (json['baseLocation'] as Map?)?.cast<String, dynamic>()),
      serviceRadiusKm: (json['serviceRadiusKm'] as num?)?.toInt() ?? 5,
      isListed: json['isListed'] as bool? ?? false,
      badge: TrustBadge.parse(verification?['badge'] as String?),
      levelsPassed: (verification?['levelsPassed'] as List?)
              ?.whereType<num>()
              .map((l) => l.toInt())
              .toList() ??
          const [],
      completeness: Completeness.fromJson(
          (json['completeness'] as Map?)?.cast<String, dynamic>()),
      skills: (json['skills'] as List?)
              ?.map(
                  (s) => OwnSkill.fromJson((s as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      priceCards: (json['priceCards'] as List?)
              ?.map((p) =>
                  OwnPriceCard.fromJson((p as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      availability: (json['availability'] as List?)
              ?.map((a) =>
                  OwnAvailability.fromJson((a as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
    );
  }
}
