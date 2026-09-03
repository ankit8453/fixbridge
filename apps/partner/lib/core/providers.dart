import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/repositories/auth_repository.dart';
import '../data/repositories/partner_repository.dart';
import '../data/repositories/verification_repository.dart';
import 'api/api_client.dart';
import 'storage/session_store.dart';

final sessionStoreProvider = Provider<SessionStore>((ref) {
  throw StateError('sessionStoreProvider must be overridden in main()');
});

/// Bumped when the API concludes the session is over.
///
/// Breaks a cycle: the client must be able to report a dead session, but the
/// auth controller needs the client to do anything at all.
final sessionLostProvider = StateProvider<int>((ref) => 0);

/// The language the app is speaking.
///
/// A technician chooses before signing in, exactly as a customer does — and
/// for this audience it matters more, not less: the people doing the work are
/// the likeliest to want Hindi.
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

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    store: ref.watch(sessionStoreProvider),
    currentLocale: () => ref.read(localeProvider).languageCode,
    onSessionLost: () {
      ref.read(sessionLostProvider.notifier).state++;
    },
  );
  ref.onDispose(client.clearTokens);
  return client;
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    ref.watch(apiClientProvider),
    ref.watch(sessionStoreProvider),
  );
});

final partnerRepositoryProvider = Provider<PartnerRepository>((ref) {
  return PartnerRepository(ref.watch(apiClientProvider));
});

final verificationRepositoryProvider = Provider<VerificationRepository>((ref) {
  return VerificationRepository(ref.watch(apiClientProvider));
});
