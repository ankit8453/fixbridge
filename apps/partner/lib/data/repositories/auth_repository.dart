import '../../core/api/api_client.dart';
import '../../core/storage/session_store.dart';
import '../models/auth.dart';

/// Sign-in, sign-out, and the account's own settings.
class AuthRepository {
  AuthRepository(this._api, this._store);

  final ApiClient _api;
  final SessionStore _store;

  /// Sends an OTP.
  ///
  /// Three independent limits sit behind this and each needs different copy,
  /// so the caller should read `ApiError.rateLimitScope` on a 429 rather than
  /// showing one generic message: `cooldown` is a 60-second resend wait,
  /// `phone` is five per window, `ip` is thirty.
  Future<OtpChallenge> requestOtp(String phone) async {
    final json = await _api.postPublic(
      '/auth/otp/request',
      body: {'phone': phone},
    );
    return OtpChallenge.fromJson(json);
  }

  /// Verifies the code and starts a session.
  ///
  /// A wrong code and "no code pending" both return the same 401 `OTP_INVALID`
  /// — deliberately indistinguishable, so the endpoint cannot be used to
  /// discover which numbers have been sent a code. After five attempts the
  /// code is cleared and the response becomes a 429.
  Future<AuthSession> verifyOtp({
    required String phone,
    required String otp,
  }) async {
    final deviceId = await _store.deviceId();
    final json = await _api.postPublic(
      '/auth/otp/verify',
      body: {'phone': phone, 'otp': otp, 'deviceId': deviceId},
    );

    final session = AuthSession.fromJson(json);
    await _persist(session);
    return session;
  }

  Future<void> _persist(AuthSession session) async {
    await _store.writeRefreshToken(session.refreshToken);
    await _store.cacheUser(session.user.toJson());
    _api.setTokens(
      AuthTokens(
        accessToken: session.accessToken,
        expiresAt: DateTime.now().add(Duration(seconds: session.expiresIn)),
      ),
    );
  }

  /// Trades the stored refresh token for a live session at launch.
  ///
  /// Returns null when there is nothing to restore, or when the token is no
  /// longer good. Not an error case — it simply means "show the sign-in
  /// screen".
  Future<AuthUser?> restoreSession() async {
    final refreshToken = await _store.readRefreshToken();
    if (refreshToken == null) return null;

    final deviceId = await _store.deviceId();
    try {
      final json = await _api.postPublic(
        '/auth/refresh',
        body: {'refreshToken': refreshToken, 'deviceId': deviceId},
      );

      final session = AuthSession.fromJson(json);
      await _persist(session);
      return session.user;
    } catch (_) {
      // Either the token is dead or the network is. Either way there is no
      // session to show; a live one will be restored on the next launch if
      // it was only the network.
      return null;
    }
  }

  /// The live user. Re-asserts server-side that the account is still active.
  Future<AuthUser> me() async {
    final json = await _api.get<Map<String, dynamic>>('/auth/me');
    final user =
        AuthUser.fromJson((json['user'] as Map).cast<String, dynamic>());
    await _store.cacheUser(user.toJson());
    return user;
  }

  /// The account's language. Retroactive — the notification inbox re-renders
  /// old messages in the new language rather than leaving them as they
  /// arrived.
  Future<AuthUser> setPreferredLanguage(String code) async {
    final json = await _api.patch<Map<String, dynamic>>(
      '/auth/me',
      body: {'preferredLanguage': code},
    );
    final user =
        AuthUser.fromJson((json['user'] as Map).cast<String, dynamic>());
    await _store.cacheUser(user.toJson());
    return user;
  }

  /// Idempotent server-side — an unknown or already-revoked token still
  /// returns 200, so this cannot be used to probe whether a token exists.
  Future<void> signOut() async {
    final refreshToken = await _store.readRefreshToken();
    if (refreshToken != null) {
      try {
        await _api
            .postPublic('/auth/logout', body: {'refreshToken': refreshToken});
      } catch (_) {
        // A failed logout call must not strand somebody in a signed-in state
        // they asked to leave. The local session goes regardless.
      }
    }
    _api.clearTokens();
    await _store.clearSession();
  }
}
