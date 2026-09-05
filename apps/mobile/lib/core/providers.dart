import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/repositories/geo_repository.dart';

import '../data/repositories/account_repository.dart';
import '../data/repositories/auth_repository.dart';
import '../data/repositories/booking_repository.dart';
import '../data/repositories/catalog_repository.dart';
import 'api/api_client.dart';
import 'storage/session_store.dart';

/// Opened once at launch and injected here, so nothing below has to deal with
/// an async store.
final sessionStoreProvider = Provider<SessionStore>((ref) {
  throw StateError('sessionStoreProvider must be overridden in main()');
});

/// Bumped whenever the API concludes the session is over for good.
///
/// This exists to break a cycle: [ApiClient] must be able to report a dead
/// session, but the auth controller needs the client to do anything at all.
/// A plain signal lets the client push without depending on the controller,
/// and the controller watch without depending on the client's construction.
final sessionLostProvider = StateProvider<int>((ref) => 0);

/// The language the app is speaking right now.
///
/// Held separately from the account's `preferredLanguage` because the choice
/// exists before there is an account to attach it to: the picker is the first
/// screen, and it must work with no session.
/// The language, and whether anyone has actually picked it.
///
/// Both live in one object because both have to be *observable*. An earlier
/// version kept `hasChosen` as a getter over the store, and the router read it
/// with `ref.watch(localeProvider.notifier)` — which watches the notifier
/// instance, not its state, so the router never re-evaluated after a choice
/// was made and the first-run picker span forever.
///
/// Carrying the flag in the state also fixes the subtler half: choosing Hindi
/// set `state` to the value it already held, so even watching the state
/// correctly would have notified nobody. The chosen flag always flips.
class LocaleState {
  const LocaleState({required this.locale, required this.chosen});

  final Locale locale;

  /// False until the picker has been answered once.
  final bool chosen;

  @override
  bool operator ==(Object other) =>
      other is LocaleState && other.locale == locale && other.chosen == chosen;

  @override
  int get hashCode => Object.hash(locale, chosen);
}

class LocaleController extends StateNotifier<LocaleState> {
  LocaleController(this._store)
      : super(
          LocaleState(
            locale: Locale(_store.localeCode ?? _fallback),
            chosen: _store.localeCode != null,
          ),
        );

  final SessionStore _store;

  /// Hindi is the fallback for a client that has expressed no preference,
  /// matching the API's own default. It is a starting point, never a lock —
  /// the picker is shown before this ever matters, and the switch in Account
  /// is permanent.
  static const _fallback = 'hi';

  static const supported = [Locale('hi'), Locale('en')];

  Future<void> set(String code) async {
    if (code != 'hi' && code != 'en') return;
    await _store.setLocaleCode(code);
    state = LocaleState(locale: Locale(code), chosen: true);
  }
}

final localeControllerProvider =
    StateNotifierProvider<LocaleController, LocaleState>((ref) {
  return LocaleController(ref.watch(sessionStoreProvider));
});

/// The active locale — what almost every caller wants.
final localeProvider =
    Provider<Locale>((ref) => ref.watch(localeControllerProvider).locale);

/// Whether the picker has been answered. Watched by the router.
final localeChosenProvider =
    Provider<bool>((ref) => ref.watch(localeControllerProvider).chosen);

/// Map lookups — search and naming a point. Server-side; see the repository.
final geoRepositoryProvider = Provider<GeoRepository>((ref) {
  return GeoRepository(ref.watch(apiClientProvider));
});

/// The one HTTP client.
final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    store: ref.watch(sessionStoreProvider),
    // Read rather than watched: a language change should affect the next
    // request, not rebuild the client and drop its in-memory access token.
    currentLocale: () => ref.read(localeProvider).languageCode,
    onSessionLost: () {
      ref.read(sessionLostProvider.notifier).state++;
    },
  );
  ref.onDispose(client.clearTokens);
  return client;
});

// ── Repositories ─────────────────────────────────────────────────────────

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    ref.watch(apiClientProvider),
    ref.watch(sessionStoreProvider),
  );
});

final catalogRepositoryProvider = Provider<CatalogRepository>((ref) {
  return CatalogRepository(ref.watch(apiClientProvider));
});

final bookingRepositoryProvider = Provider<BookingRepository>((ref) {
  return BookingRepository(ref.watch(apiClientProvider));
});

final accountRepositoryProvider = Provider<AccountRepository>((ref) {
  return AccountRepository(ref.watch(apiClientProvider));
});
