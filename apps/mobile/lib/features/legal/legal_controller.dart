import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/providers.dart';
import '../../data/models/legal.dart';
import '../../data/repositories/legal_repository.dart';
import '../auth/auth_controller.dart';

/// Where a signed-in customer is with the current Customer Terms.
enum LegalStage {
  /// Nobody is signed in, so there is nothing to ask.
  idle,

  /// Signed in, and `GET /legal/me` has not answered yet.
  checking,

  /// The current version has not been accepted. The terms screen is up and
  /// nothing else is reachable.
  required,

  /// The status could not be fetched. Treated exactly like [required] for
  /// routing — a failed check never lets somebody through — but the screen
  /// shows a retry instead of the terms.
  failed,

  /// Accepted. Held for the rest of the session so navigation does not
  /// re-ask the server.
  accepted,
}

class LegalState {
  const LegalState({
    required this.stage,
    this.terms = LegalDocStatus.unknown,
    this.error,
    this.busy = false,
    this.termsChanged = false,
  });

  final LegalStage stage;

  /// The Customer Terms as last reported. [LegalDocStatus.unknown] until the
  /// first answer.
  final LegalDocStatus terms;

  /// Why the last fetch failed, when [stage] is [LegalStage.failed].
  final Object? error;

  /// A retry or a re-fetch is in flight while the screen stays up.
  final bool busy;

  /// The version moved under the customer while they were reading it — the
  /// accept came back `LEGAL_VERSION_OUTDATED` and the screen now shows the
  /// new one with a notice saying so.
  final bool termsChanged;

  LegalState copyWith({bool? busy}) => LegalState(
        stage: stage,
        terms: terms,
        error: error,
        busy: busy ?? this.busy,
        termsChanged: termsChanged,
      );

  static const idle = LegalState(stage: LegalStage.idle);
}

/// Fetches and records acceptance of the Customer Terms.
///
/// Follows the session on its own: it starts a check whenever a new person
/// signs in — a fresh OTP sign-in and a session restored at launch look the
/// same from here — and forgets everything on sign-out, so the next account
/// on this phone is asked afresh.
class LegalController extends StateNotifier<LegalState> {
  LegalController(this._ref) : super(LegalState.idle) {
    _ref.listen<AuthState>(
      authControllerProvider,
      (_, next) => _onAuth(next),
      fireImmediately: true,
    );
  }

  final Ref _ref;

  /// Whose status [state] describes. A change of name or language re-emits
  /// the auth state for the same person; that must not trigger a refetch.
  String? _userId;

  /// Bumped on every change of person, so an answer that arrives after a
  /// sign-out cannot land on the next account.
  int _generation = 0;

  LegalRepository get _repo => _ref.read(legalRepositoryProvider);

  void _onAuth(AuthState auth) {
    final id = auth.isSignedIn ? auth.user!.id : null;
    if (id == _userId) return;

    _userId = id;
    _generation++;

    if (id == null) {
      state = LegalState.idle;
      return;
    }

    state = const LegalState(stage: LegalStage.checking);
    unawaited(_fetch(_generation));
  }

  Future<void> _fetch(int generation, {bool termsChanged = false}) async {
    try {
      final status = await _repo.status();
      if (!mounted || generation != _generation) return;
      _apply(status.customerTerms, termsChanged: termsChanged);
    } catch (e) {
      if (!mounted || generation != _generation) return;
      state = LegalState(stage: LegalStage.failed, error: e);
    }
  }

  void _apply(LegalDocStatus terms, {bool termsChanged = false}) {
    state = terms.accepted
        ? LegalState(stage: LegalStage.accepted, terms: terms)
        : LegalState(
            stage: LegalStage.required,
            terms: terms,
            termsChanged: termsChanged,
          );
  }

  /// Asks again after a failed fetch. The screen stays where it is.
  Future<void> retry() async {
    if (_userId == null || state.busy) return;
    state = state.copyWith(busy: true);
    await _fetch(_generation);
  }

  /// Records acceptance of [version] — the one that was on screen, not
  /// whatever happens to be current by the time the request lands.
  ///
  /// When the server says that version is outdated, the new status is fetched
  /// and the screen stays up with a notice; that is not an error to the
  /// caller. Any other failure is rethrown as the [ApiError] it was.
  Future<void> accept(String version) async {
    final generation = _generation;
    try {
      final status = await _repo.acceptCustomerTerms(version);
      if (!mounted || generation != _generation) return;
      _apply(status.customerTerms);
    } on ApiError catch (e) {
      if (e.code != LegalRepository.versionOutdatedCode) rethrow;
      if (!mounted || generation != _generation) return;
      state = state.copyWith(busy: true);
      await _fetch(generation, termsChanged: true);
    }
  }
}

final legalControllerProvider =
    StateNotifierProvider<LegalController, LegalState>((ref) {
  return LegalController(ref);
});

/// What the router needs to know, and nothing more.
enum LegalGate {
  /// Nothing to block: signed out, or the current terms are accepted.
  open,

  /// Signed in, status not known yet. The router holds on the splash screen
  /// rather than flashing either the terms or the home screen.
  pending,

  /// Signed in and not accepted — or the check failed. Only the terms
  /// screen is reachable.
  blocked,
}

/// Collapsed to three values so the router, which rebuilds on every change
/// to what it watches, does not rebuild for a spinner or a notice.
final legalGateProvider = Provider<LegalGate>((ref) {
  // Watched before the sign-in check so the controller exists — and is
  // listening for the sign-in — from the router's very first build.
  final stage = ref.watch(legalControllerProvider.select((s) => s.stage));
  final signedIn =
      ref.watch(authControllerProvider.select((a) => a.isSignedIn));

  if (!signedIn) return LegalGate.open;

  return switch (stage) {
    LegalStage.accepted => LegalGate.open,
    LegalStage.idle || LegalStage.checking => LegalGate.pending,
    LegalStage.required || LegalStage.failed => LegalGate.blocked,
  };
});
