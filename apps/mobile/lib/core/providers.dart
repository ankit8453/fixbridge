import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
class LocaleController extends StateNotifier<Locale> {
  LocaleController(this._store)
      : super(Locale(_store.localeCode ?? _fallback));

  final SessionStore _store;

  /// Hindi is the fallback for a client that has expressed no preference,
  /// matching the API's own default. It is a starting point, never a lock —
  /// the picker is shown before this ever matters, and the switch in Account
  /// is permanent.
  static const _fallback = 'hi';

  static const supported = [Locale('hi'), Locale('en')];

  bool get hasChosen => _store.localeCode != null;

  Future<void> set(String code) async {
    if (code != 'hi' && code != 'en') return;
    await _store.setLocaleCode(code);
    state = Locale(code);
  }
}

final localeProvider =
    StateNotifierProvider<LocaleController, Locale>((ref) {
  return LocaleController(ref.watch(sessionStoreProvider));
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
