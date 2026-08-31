import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/location.dart';
import '../../core/providers.dart';
import '../../data/models/category.dart';
import '../../data/repositories/catalog_repository.dart';

/// What the customer is currently asking for.
///
/// Held as one object rather than several providers so that changing two
/// things at once — picking a category *and* switching the sort — fires a
/// single search instead of two.
class SearchQuery {
  const SearchQuery({
    this.text = '',
    this.categoryId,
    this.sort = 'rank',
    this.maxDistanceKm,
  });

  final String text;
  final int? categoryId;

  /// `rank` (default), `distance` or `price_low`.
  final String sort;

  final double? maxDistanceKm;

  SearchQuery copyWith({
    String? text,
    int? categoryId,
    bool clearCategory = false,
    String? sort,
    double? maxDistanceKm,
  }) {
    return SearchQuery(
      text: text ?? this.text,
      categoryId: clearCategory ? null : (categoryId ?? this.categoryId),
      sort: sort ?? this.sort,
      maxDistanceKm: maxDistanceKm ?? this.maxDistanceKm,
    );
  }
}

final searchQueryProvider =
    StateProvider<SearchQuery>((ref) => const SearchQuery());

/// Jabalpur city centre — the origin of last resort.
///
/// Used only when there is no better answer: no saved location, and either a
/// refused permission or a fix that never arrived. Searching from here is
/// wrong for everybody not standing in the middle of town, which is why it is
/// a fallback and not the default it used to be.
const _cityCentre = (lat: 23.1815, lng: 79.9864);

/// Where to search from, resolved once and reused.
///
/// The API requires `lat`/`lng` — there is no "search everywhere" — so this
/// always produces a point. The order is deliberate:
///
///   1. the device's location, if it will give one,
///   2. the last place that worked, so a refusal does not reset somebody to
///      the middle of town every launch,
///   3. the city centre.
///
/// [usingFallback] is exposed so the UI can say so. A distance computed from
/// the wrong origin looks exactly like a correct one, and silently showing
/// "1.2 km away" when it is really twelve is worse than admitting the app
/// does not know where somebody is.
final searchOriginProvider =
    FutureProvider<({double lat, double lng, bool usingFallback})>((ref) async {
  final store = ref.read(sessionStoreProvider);

  final result = await DeviceLocation.current();
  if (result is LocationFound) {
    await store.setLastLocation(result.lat, result.lng);
    return (lat: result.lat, lng: result.lng, usingFallback: false);
  }

  final saved = store.lastLocation;
  if (saved != null) {
    return (lat: saved.$1, lng: saved.$2, usingFallback: false);
  }

  return (
    lat: _cityCentre.lat,
    lng: _cityCentre.lng,
    usingFallback: true,
  );
});

/// Type-ahead suggestions.
///
/// Debounced by 300ms because this fires on every keystroke and shares a
/// 30-request-per-minute per-IP budget with the search itself — an
/// undebounced field would spend the whole budget on one word.
final suggestionsProvider =
    FutureProvider.autoDispose<List<CategorySuggestion>>((ref) async {
  final text = ref.watch(searchQueryProvider).text.trim();
  if (text.length < 2) return const [];

  // Cancelled and restarted on each keystroke; only the last one runs.
  //
  // `disposed` is tracked by hand because a FutureProvider's ref has no
  // `mounted` — without it, a request would still fire for a query the user
  // has already typed past.
  var disposed = false;
  final completer = Completer<void>();
  final timer = Timer(const Duration(milliseconds: 300), completer.complete);
  ref.onDispose(() {
    disposed = true;
    timer.cancel();
    if (!completer.isCompleted) completer.complete();
  });
  await completer.future;
  if (disposed) return const [];

  final store = ref.read(sessionStoreProvider);
  return ref
      .read(catalogRepositoryProvider)
      .resolve(text, cityId: store.cityId);
});

/// The ranked results.
final searchResultsProvider =
    FutureProvider.autoDispose<SearchResults>((ref) async {
  final query = ref.watch(searchQueryProvider);
  final origin = await ref.watch(searchOriginProvider.future);
  final store = ref.read(sessionStoreProvider);

  return ref.read(catalogRepositoryProvider).searchProviders(
        lat: origin.lat,
        lng: origin.lng,
        cityId: store.cityId,
        categoryId: query.categoryId,
        sort: query.sort,
        maxDistanceKm: query.maxDistanceKm,
      );
});
