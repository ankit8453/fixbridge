import '../../core/api/api_client.dart';
import '../models/category.dart';
import '../models/provider.dart';

/// Browsing: categories, search, profiles, slots and reviews.
///
/// **Every endpoint in here is public.** A customer chooses a technician
/// before they sign in, and demanding an account first is the fastest way to
/// lose them — so the whole browse path works with no token and the phone
/// number is asked for at *Book*.
///
/// They share one per-IP rate budget (30/min by default), so the search-as-you-
/// type call is debounced rather than fired on every keystroke.
class CatalogRepository {
  CatalogRepository(this._api);

  final ApiClient _api;

  /// The service tree. Counts inside are cached five minutes server-side —
  /// a browsing hint, not a live figure.
  Future<List<ServiceCategory>> categories({int? cityId}) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/categories',
      query: {'cityId': cityId},
      auth: false,
    );
    return (json['categories'] as List)
        .map(
            (c) => ServiceCategory.fromJson((c as Map).cast<String, dynamic>()))
        .toList();
  }

  /// Free text — in either script — to category suggestions. Called as the
  /// customer types, then the chosen category is passed to [searchProviders].
  Future<List<CategorySuggestion>> resolve(
    String query, {
    int? cityId,
    int limit = 8,
  }) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/search/resolve',
      query: {'q': query, 'city_id': cityId, 'limit': limit},
      auth: false,
    );
    return (json['suggestions'] as List)
        .map((s) =>
            CategorySuggestion.fromJson((s as Map).cast<String, dynamic>()))
        .toList();
  }

  /// Ranked technicians near a point.
  ///
  /// `lat`/`lng` are required — there is no "search everywhere". Only
  /// listed, verified, active providers are ever returned, and no parameter
  /// relaxes that.
  ///
  /// The availability trio is all-or-nothing: pass all three of [date],
  /// [startTime] and [endTime] or none, or the API returns a 400 pointing at
  /// `date`.
  Future<SearchResults> searchProviders({
    required double lat,
    required double lng,
    int? cityId,
    int? categoryId,
    String? date,
    String? startTime,
    String? endTime,
    double? maxDistanceKm,
    String sort = 'rank',
    int page = 1,
    int pageSize = 10,
  }) async {
    final hasWindow = date != null && startTime != null && endTime != null;

    final json = await _api.get<Map<String, dynamic>>(
      '/search/providers',
      query: {
        'lat': lat,
        'lng': lng,
        'city_id': cityId,
        'category_id': categoryId,
        if (hasWindow) 'date': date,
        if (hasWindow) 'start_time': startTime,
        if (hasWindow) 'end_time': endTime,
        'max_distance_km': maxDistanceKm,
        'sort': sort,
        'page': page,
        'page_size': pageSize,
      },
      auth: false,
    );
    return SearchResults.fromJson(json);
  }

  /// A public profile.
  ///
  /// A 404 covers "does not exist", "not listed" and "suspended" alike, so
  /// that the endpoint cannot be used to discover a suspension. Copy for it
  /// must be "not available right now" — anything more specific would be a
  /// guess, and a wrong one.
  Future<ProviderProfile> profile(String providerId) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/providers/$providerId',
      auth: false,
    );
    return ProviderProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  /// Open slots in a window. Booked hours are never returned.
  Future<List<ProviderSlot>> slots(
    String providerId, {
    required DateTime from,
    required DateTime to,
  }) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/providers/$providerId/slots',
      query: {
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
      },
      auth: false,
    );
    return (json['slots'] as List)
        .map((s) => ProviderSlot.fromJson((s as Map).cast<String, dynamic>()))
        .toList();
  }

  /// Published customer→provider reviews only.
  Future<ReviewsPage> reviews(
    String providerId, {
    int page = 1,
    int pageSize = 10,
  }) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/providers/$providerId/reviews',
      query: {'page': page, 'page_size': pageSize},
      auth: false,
    );
    return ReviewsPage.fromJson(json);
  }

  /// Flags a photo for a human to look at. The report count is deliberately
  /// not returned — telling a reporter how close they are to a takedown
  /// invites organised abuse.
  Future<void> reportPhoto(String photoId, String reason) async {
    await _api.post<Map<String, dynamic>>(
      '/provider-photos/$photoId/report',
      body: {'reason': reason},
    );
  }
}

/// A page of search results.
class SearchResults {
  const SearchResults({
    required this.results,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.truncated,
    required this.sort,
  });

  final List<ProviderCard> results;
  final int page;
  final int pageSize;

  /// May exceed what was actually ranked — see [truncated].
  final int total;

  /// True when more matched than the ranking stage would consider. The UI
  /// should say "many available" rather than quoting [total] as exact.
  final bool truncated;

  final String sort;

  bool get hasMore => page * pageSize < total;

  factory SearchResults.fromJson(Map<String, dynamic> json) => SearchResults(
        results: (json['results'] as List)
            .map((r) =>
                ProviderCard.fromJson((r as Map).cast<String, dynamic>()))
            .toList(),
        page: (json['page'] as num?)?.toInt() ?? 1,
        pageSize: (json['pageSize'] as num?)?.toInt() ?? 10,
        total: (json['total'] as num?)?.toInt() ?? 0,
        truncated: json['truncated'] as bool? ?? false,
        sort: json['sort'] as String? ?? 'rank',
      );
}

/// A page of reviews plus the aggregates that sit above them.
class ReviewsPage {
  const ReviewsPage({
    required this.averageStars,
    required this.reviewCount,
    required this.tagCounts,
    required this.reviews,
    required this.page,
    required this.total,
  });

  final double? averageStars;
  final int reviewCount;
  final Map<String, int> tagCounts;
  final List<ProviderReview> reviews;
  final int page;
  final int total;

  factory ReviewsPage.fromJson(Map<String, dynamic> json) => ReviewsPage(
        averageStars: (json['averageStars'] as num?)?.toDouble(),
        reviewCount: (json['reviewCount'] as num?)?.toInt() ?? 0,
        tagCounts: (json['tagCounts'] as Map?)?.map(
              (k, v) => MapEntry(k as String, (v as num).toInt()),
            ) ??
            const {},
        reviews: (json['reviews'] as List?)
                ?.map((r) =>
                    ProviderReview.fromJson((r as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
        page: (json['page'] as num?)?.toInt() ?? 1,
        total: (json['total'] as num?)?.toInt() ?? 0,
      );
}
