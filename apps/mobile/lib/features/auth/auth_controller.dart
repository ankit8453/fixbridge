import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../data/models/auth.dart';

/// Where the app is in the sign-in journey.
enum AuthStage {
  /// Restoring a stored session. The splash screen holds here.
  starting,

  /// Nobody is signed in. Browsing still works — the whole search path is
  /// public — but booking needs a phone number.
  signedOut,

  signedIn,
}

class AuthState {
  const AuthState({
    required this.stage,
    this.user,
    this.needsName = false,
  });

  final AuthStage stage;
  final AuthUser? user;

  /// True immediately after the account was created by an OTP verification,
  /// when the app asks for a name once and never again.
  final bool needsName;

  bool get isSignedIn => stage == AuthStage.signedIn && user != null;
  bool get isStarting => stage == AuthStage.starting;

  AuthState copyWith({AuthStage? stage, AuthUser? user, bool? needsName}) {
    return AuthState(
      stage: stage ?? this.stage,
      user: user ?? this.user,
      needsName: needsName ?? this.needsName,
    );
  }

  static const initial = AuthState(stage: AuthStage.starting);
}

/// Holds the session and owns the OTP flow.
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(AuthState.initial) {
    // The API client reports a dead session through a plain signal rather
    // than by calling in here, which keeps the two from depending on each
    // other's construction. See sessionLostProvider.
    _ref.listen<int>(sessionLostProvider, (_, __) => _onSessionLost());
  }

  final Ref _ref;

  /// The number a code was last sent to, kept so the OTP screen can verify
  /// without the caller threading it through navigation.
  String? _pendingPhone;
  String? get pendingPhone => _pendingPhone;

  /// Masked, for display on the OTP screen: "+9198765*****".
  String? _maskedPhone;
  String? get maskedPhone => _maskedPhone;

  /// Restores a session at launch, if there is one to restore.
  ///
  /// A failure here is not an error state — it means "show sign-in". The one
  /// case worth distinguishing is a dead network, and even then the honest
  /// outcome is the same: nothing to show until it comes back.
  Future<void> start() async {
    final repo = _ref.read(authRepositoryProvider);
    final user = await repo.restoreSession();

    if (!mounted) return;
    if (user == null) {
      state = const AuthState(stage: AuthStage.signedOut);
      return;
    }

    state = AuthState(stage: AuthStage.signedIn, user: user);

    // The customer's chosen name lives on their profile rather than the user
    // row, so a session restored from `/auth/me` alone comes back nameless
    // even after they have set one. Fetched separately and folded in.
    try {
      final profile = await _ref.read(accountRepositoryProvider).profile();
      if (mounted && profile.displayName != null) {
        state = state.copyWith(user: user.withName(profile.displayName));
      }
    } catch (_) {
      // A greeting is not worth blocking the app for.
    }
  }

  /// Sends a code. Throws [ApiError] — the caller shows the message, and
  /// branches on `rateLimitScope` when it is a 429.
  Future<OtpChallenge> requestOtp(String phone) async {
    final challenge = await _ref.read(authRepositoryProvider).requestOtp(phone);
    _pendingPhone = phone;
    _maskedPhone = challenge.maskedPhone;
    return challenge;
  }

  /// Verifies and signs in.
  ///
  /// A wrong code and an expired one are the same `OTP_INVALID` by design, so
  /// the screen must not try to tell them apart.
  Future<void> verifyOtp(String otp) async {
    final phone = _pendingPhone;
    if (phone == null) {
      throw ApiError(
        code: 'NO_PENDING_OTP',
        message: 'Ask for a new code.',
        statusCode: 400,
      );
    }

    final session = await _ref
        .read(authRepositoryProvider)
        .verifyOtp(phone: phone, otp: otp);

    if (!mounted) return;
    state = AuthState(
      stage: AuthStage.signedIn,
      user: session.user,
      needsName: session.isNewUser,
    );

    // The account's stored language should match what they picked before
    // signing in, so the WhatsApp messages arrive in the same language as
    // the app. Fire and forget — a failure here is not worth blocking on.
    final chosen = _ref.read(localeProvider).languageCode;
    if (chosen != session.user.preferredLanguage) {
      unawaited(_syncLanguage(chosen));
    }
  }

  Future<void> _syncLanguage(String code) async {
    try {
      final user =
          await _ref.read(authRepositoryProvider).setPreferredLanguage(code);
      if (!mounted) return;

      /// Keep the name that is already on screen.
      ///
      /// This endpoint answers with the `users` row, whose `name` column is
      /// **not** where a customer's display name lives — that is
      /// `customer_profiles.display_name`, exactly as `setName` below
      /// explains. Taking the response wholesale therefore overwrote a real
      /// name with the null beside it, and the name vanished from the account
      /// screen on every single language change.
      final existing = state.user?.name;
      state = state.copyWith(
        user: existing == null ? user : user.withName(existing),
      );
    } catch (_) {
      // The app language is already right; only the server copy is stale,
      // and Account can fix it later.
    }
  }

  /// Changes the language everywhere: the app now, and the account — which
  /// means WhatsApp messages and the notification inbox follow.
  Future<void> setLanguage(String code) async {
    await _ref.read(localeControllerProvider.notifier).set(code);
    if (state.isSignedIn) await _syncLanguage(code);
  }

  /// Names the account.
  ///
  /// The name is written to `customer_profiles.display_name`, which is **not**
  /// the same column as the `users.name` that `/auth/me` returns. Re-reading
  /// `/auth/me` after saving therefore hands back the old value and the screen
  /// looks like the save silently failed — so the saved profile's own answer is
  /// used instead.
  Future<void> setName(String name) async {
    final profile = await _ref
        .read(accountRepositoryProvider)
        .updateProfile(displayName: name);

    if (!mounted) return;
    final current = state.user;
    if (current == null) return;

    state = state.copyWith(
      user: current.withName(profile.displayName),
      needsName: false,
    );
  }

  void nameHandled() {
    if (mounted) state = state.copyWith(needsName: false);
  }

  Future<void> signOut() async {
    await _ref.read(authRepositoryProvider).signOut();
    _pendingPhone = null;
    _maskedPhone = null;
    if (mounted) state = const AuthState(stage: AuthStage.signedOut);
  }

  void _onSessionLost() {
    _pendingPhone = null;
    _maskedPhone = null;
    if (mounted) state = const AuthState(stage: AuthStage.signedOut);
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref);
});

/// Convenience for the many widgets that only care whether there is a user.
final currentUserProvider = Provider<AuthUser?>((ref) {
  return ref.watch(authControllerProvider).user;
});
