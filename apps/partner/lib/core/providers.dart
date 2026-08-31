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
class LocaleController extends StateNotifier<Locale> {
  LocaleController(this._store) : super(Locale(_store.localeCode ?? _fallback));

  final SessionStore _store;
  static const _fallback = 'hi';
  static const supported = [Locale('hi'), Locale('en')];

  bool get hasChosen => _store.localeCode != null;

  Future<void> set(String code) async {
    if (code != 'hi' && code != 'en') return;
    await _store.setLocaleCode(code);
    state = Locale(code);
  }
}

final localeProvider = StateNotifierProvider<LocaleController, Locale>((ref) {
  return LocaleController(ref.watch(sessionStoreProvider));
});

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
