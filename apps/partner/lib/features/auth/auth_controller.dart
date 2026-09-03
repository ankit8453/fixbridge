import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../data/models/auth.dart';

enum AuthStage {
  starting,
  signedOut,

  /// Signed in, but the account has no technician role yet — they need to
  /// register before any of the work screens exist for them.
  needsRegistration,

  signedIn,
}

class AuthState {
  const AuthState({required this.stage, this.user});

  final AuthStage stage;
  final AuthUser? user;

  bool get isSignedIn => stage == AuthStage.signedIn && user != null;
  bool get isStarting => stage == AuthStage.starting;

  AuthState copyWith({AuthStage? stage, AuthUser? user}) =>
      AuthState(stage: stage ?? this.stage, user: user ?? this.user);

  static const initial = AuthState(stage: AuthStage.starting);
}

/// Session and role.
///
/// Nearly identical to the customer app's, with one addition that is easy to
/// get wrong: the `technician` role is baked into the access token's claims,
/// so registering is not enough — the session has to be refreshed before the
/// role exists as far as the API is concerned.
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(AuthState.initial) {
    _ref.listen<int>(sessionLostProvider, (_, __) => _onSessionLost());
  }

  final Ref _ref;

  String? _pendingPhone;
  String? get pendingPhone => _pendingPhone;

  String? _maskedPhone;
  String? get maskedPhone => _maskedPhone;

  Future<void> start() async {
    final user = await _ref.read(authRepositoryProvider).restoreSession();

    if (!mounted) return;
    state = _stateFor(user);
  }

  AuthState _stateFor(AuthUser? user) {
    if (user == null) return const AuthState(stage: AuthStage.signedOut);
    return AuthState(
      stage:
          user.isTechnician ? AuthStage.signedIn : AuthStage.needsRegistration,
      user: user,
    );
  }

  Future<OtpChallenge> requestOtp(String phone) async {
    final challenge = await _ref.read(authRepositoryProvider).requestOtp(phone);
    _pendingPhone = phone;
    _maskedPhone = challenge.maskedPhone;
    return challenge;
  }

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
    state = _stateFor(session.user);

    final chosen = _ref.read(localeProvider).languageCode;
    if (chosen != session.user.preferredLanguage) {
      unawaited(_syncLanguage(chosen));
    }
  }

  /// Becomes a technician.
  ///
  /// The refresh afterwards is not optional. `POST /providers/me/register`
  /// grants the role in the database, but the access token in memory was
  /// minted before that and does not carry it — so without re-reading the
  /// session every technician route answers 403, which looks like a
  /// permissions bug rather than a stale token.
  Future<void> registerAsTechnician({String? displayName}) async {
    await _ref
        .read(partnerRepositoryProvider)
        .register(displayName: displayName);

    final user = await _ref.read(authRepositoryProvider).restoreSession();
    if (!mounted) return;

    state = _stateFor(user);
  }

  Future<void> _syncLanguage(String code) async {
    try {
      final user =
          await _ref.read(authRepositoryProvider).setPreferredLanguage(code);
      if (mounted) state = state.copyWith(user: user);
    } catch (_) {
      // The app is already in the right language; only the server copy is
      // stale, and Account can fix it later.
    }
  }

  Future<void> setLanguage(String code) async {
    await _ref.read(localeControllerProvider.notifier).set(code);
    if (state.isSignedIn) await _syncLanguage(code);
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

final currentUserProvider = Provider<AuthUser?>((ref) {
  return ref.watch(authControllerProvider).user;
});
