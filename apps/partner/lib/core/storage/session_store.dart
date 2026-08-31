import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Everything that survives a restart.
///
/// The split is deliberate. The refresh token and the device id go in the
/// keystore; the language choice and the last city go in plain preferences.
/// Nothing else persists at all — in particular no booking, because a cached
/// booking that redraws a stale OTP is worse than a spinner: the end code
/// exists only while work is in progress, and showing yesterday's is how a
/// technician ends up unable to close a job.
class SessionStore {
  SessionStore(this._secure, this._prefs);

  final FlutterSecureStorage _secure;
  final SharedPreferences _prefs;

  static const _kRefreshToken = 'fb.refresh_token';
  static const _kDeviceId = 'fb.device_id';
  static const _kLocale = 'fb.locale';
  static const _kCityId = 'fb.city_id';
  static const _kOnboarded = 'fb.onboarded';

  static Future<SessionStore> open() async {
    const secure = FlutterSecureStorage(
      aOptions: AndroidOptions(encryptedSharedPreferences: true),
    );
    final prefs = await SharedPreferences.getInstance();
    return SessionStore(secure, prefs);
  }

  // ── Refresh token ──────────────────────────────────────────────────────
  Future<String?> readRefreshToken() => _secure.read(key: _kRefreshToken);

  Future<void> writeRefreshToken(String token) =>
      _secure.write(key: _kRefreshToken, value: token);

  Future<void> clearRefreshToken() => _secure.delete(key: _kRefreshToken);

  // ── Device id ──────────────────────────────────────────────────────────
  /// Stable for the life of the install, and that stability is load-bearing:
  /// the id is baked into the access token's claims and the refresh token is
  /// bound to it, so regenerating it on each launch breaks refresh permanently
  /// and signs the user out on the first token expiry.
  ///
  /// The API constrains it to 8–128 chars of `[A-Za-z0-9._:-]`, so the
  /// generated value stays inside that alphabet rather than relying on a
  /// package whose format could drift.
  Future<String> deviceId() async {
    final existing = await _secure.read(key: _kDeviceId);
    if (existing != null && existing.length >= 8) return existing;

    const alphabet =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    final rng = Random.secure();
    final generated =
        List.generate(24, (_) => alphabet[rng.nextInt(alphabet.length)]).join();
    final id = 'fb-$generated';

    await _secure.write(key: _kDeviceId, value: id);
    return id;
  }

  // ── Preferences ────────────────────────────────────────────────────────
  /// `null` until the user has chosen. The picker is shown on that basis —
  /// the language is never inferred from the phone's locale, because a phone
  /// set to English is not a statement that its owner reads English best.
  String? get localeCode => _prefs.getString(_kLocale);

  Future<void> setLocaleCode(String code) => _prefs.setString(_kLocale, code);

  int? get cityId => _prefs.getInt(_kCityId);

  Future<void> setCityId(int id) => _prefs.setInt(_kCityId, id);

  bool get hasOnboarded => _prefs.getBool(_kOnboarded) ?? false;

  Future<void> setOnboarded() => _prefs.setBool(_kOnboarded, true);

  /// Signing out clears the token but keeps the device id and the language.
  /// The next person to use the phone is almost always the same person.
  Future<void> clearSession() async {
    await clearRefreshToken();
  }

  /// Debug helper for a wedged install; not reachable from the UI.
  Future<void> wipe() async {
    await _secure.deleteAll();
    await _prefs.remove(_kLocale);
    await _prefs.remove(_kCityId);
    await _prefs.remove(_kOnboarded);
  }

  /// Kept for the cached-user snapshot the splash screen reads so it can draw
  /// a name before `/auth/me` answers.
  Future<void> cacheUser(Map<String, dynamic> user) =>
      _secure.write(key: 'fb.user', value: jsonEncode(user));

  Future<Map<String, dynamic>?> cachedUser() async {
    final raw = await _secure.read(key: 'fb.user');
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }
}
