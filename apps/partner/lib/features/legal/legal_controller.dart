import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_error.dart';
import '../../core/config/env.dart';
import '../../core/providers.dart';
import '../../data/models/legal.dart';
import '../../l10n/app_text.dart';
import '../auth/auth_controller.dart';

/// Where the partner-agreement gate stands for the signed-in person.
enum LegalGate {
  /// No session, so nothing to ask about.
  idle,

  /// Asking the API. The router holds on the splash screen meanwhile.
  loading,

  /// The current version has not been accepted. Every route but the
  /// agreement screen is closed.
  required,

  /// Could not find out. Treated exactly like [required] by the router —
  /// never let through on a failure — but the screen offers Retry.
  failed,

  accepted,
}

/// Something worth telling the person above the agreement.
enum LegalNotice {
  /// They tapped Accept on a version that was replaced while they read it.
  versionChanged,
}

class LegalState {
  const LegalState({
    required this.gate,
    this.userId,
    this.partner,
    this.notice,
    this.acceptError,
    this.submitting = false,
  });

  final LegalGate gate;

  /// Whose answer this is. A state for somebody else — the previous account
  /// on this phone — counts as not known yet.
  final String? userId;

  /// What was last fetched. Kept through a refetch so the screen does not
  /// blank out while it reloads.
  final LegalDocStatus? partner;

  final LegalNotice? notice;

  /// The server's own (localised) words when accepting failed.
  final String? acceptError;

  /// An accept is in flight.
  final bool submitting;

  static const idle = LegalState(gate: LegalGate.idle);

  /// The gate as it applies to [currentUserId]. Anything recorded for a
  /// different person is not an answer for this one.
  LegalGate gateFor(String? currentUserId) {
    if (currentUserId == null) return LegalGate.idle;
    if (userId != currentUserId) return LegalGate.loading;
    return gate == LegalGate.idle ? LegalGate.loading : gate;
  }

  LegalState copyWith({
    LegalGate? gate,
    bool? submitting,
    String? acceptError,
    bool clearAcceptError = false,
    bool clearNotice = false,
  }) =>
      LegalState(
        gate: gate ?? this.gate,
        userId: userId,
        partner: partner,
        notice: clearNotice ? null : notice,
        acceptError: clearAcceptError ? null : (acceptError ?? this.acceptError),
        submitting: submitting ?? this.submitting,
      );
}

/// The partner-agreement gate.
///
/// Fetched once per session — on a fresh sign-in and when a stored session
/// is restored on launch — and held in memory until sign-out. The router
/// reads it and refuses every other route until [LegalGate.accepted].
///
/// Applies to anyone with a session, including somebody not yet registered
/// as a technician: they accept before they set up, not after.
class LegalController extends StateNotifier<LegalState> {
  LegalController(
    this._ref, {
    LegalState initial = LegalState.idle,
    bool followAuth = true,
  }) : super(initial) {
    if (followAuth) {
      _ref.listen<AuthState>(
        authControllerProvider,
        (_, next) => _onAuth(next),
        fireImmediately: true,
      );
    }
  }

  final Ref _ref;

  /// Bumped on every load and on sign-out, so an answer that arrives for a
  /// session that has since ended is dropped rather than applied.
  int _generation = 0;

  static String? _sessionUserId(AuthState auth) {
    final hasSession = auth.stage == AuthStage.signedIn ||
        auth.stage == AuthStage.needsRegistration;
    return hasSession ? auth.user?.id : null;
  }

  void _onAuth(AuthState auth) {
    final id = _sessionUserId(auth);

    if (id == null) {
      _generation++;
      if (state.gate != LegalGate.idle || state.userId != null) {
        state = LegalState.idle;
      }
      return;
    }

    // Same person — registering, or a refreshed user object. The cached
    // answer stands for the rest of the session.
    if (state.userId == id && state.gate != LegalGate.idle) return;

    _load(id);
  }

  Future<void> _load(String userId, {LegalNotice? notice}) async {
    final generation = ++_generation;

    state = state.userId == userId
        ? state.copyWith(gate: LegalGate.loading)
        : LegalState(gate: LegalGate.loading, userId: userId);

    try {
      final status = await _ref.read(legalRepositoryProvider).status();
      if (!mounted || generation != _generation) return;
      state = _stateFor(userId, status.partnerTerms, notice: notice);
    } catch (e) {
      if (!mounted || generation != _generation) return;
      state = LegalState(gate: LegalGate.failed, userId: userId);
    }
  }

  static LegalState _stateFor(
    String userId,
    LegalDocStatus partner, {
    LegalNotice? notice,
  }) {
    if (partner.accepted) {
      return LegalState(
        gate: LegalGate.accepted,
        userId: userId,
        partner: partner,
      );
    }
    // Nothing can be accepted without knowing which version — that is the
    // whole of the evidence. A body without one is a failed load, not a
    // pass and not an Accept button that posts nothing.
    if (partner.currentVersion == null) {
      return LegalState(gate: LegalGate.failed, userId: userId);
    }
    return LegalState(
      gate: LegalGate.required,
      userId: userId,
      partner: partner,
      notice: notice,
    );
  }

  /// After a failed load.
  Future<void> retry() async {
    final id = state.userId ?? _sessionUserId(_ref.read(authControllerProvider));
    if (id == null) return;
    await _load(id);
  }

  /// Accepts the version on screen. On success the router moves on by
  /// itself; nothing here navigates.
  Future<void> accept() async {
    final userId = state.userId;
    final version = state.partner?.currentVersion;
    if (state.gate != LegalGate.required ||
        state.submitting ||
        userId == null ||
        version == null) {
      return;
    }

    final generation = _generation;
    state = state.copyWith(
      submitting: true,
      clearAcceptError: true,
      clearNotice: true,
    );

    try {
      final status =
          await _ref.read(legalRepositoryProvider).acceptPartnerTerms(version);
      if (!mounted || generation != _generation) return;

      final next = _stateFor(userId, status.partnerTerms);
      state = next.gate == LegalGate.accepted
          ? next
          // A 200 that still says "not accepted" is not a pass.
          : LegalState(
              gate: LegalGate.required,
              userId: userId,
              partner: state.partner,
              acceptError: tr('common.somethingWentWrong'),
            );
    } on ApiError catch (e) {
      if (!mounted || generation != _generation) return;
      if (e.code == ApiError.legalVersionOutdated) {
        // Replaced while they read it. Fetch the new version and ask again,
        // with the box unticked — agreeing to one text is not agreeing to
        // the next.
        await _load(userId, notice: LegalNotice.versionChanged);
        return;
      }
      state = state.copyWith(submitting: false, acceptError: e.message);
    } catch (_) {
      if (!mounted || generation != _generation) return;
      state = state.copyWith(
        submitting: false,
        acceptError: tr('common.somethingWentWrong'),
      );
    }
  }
}

final legalControllerProvider =
    StateNotifierProvider<LegalController, LegalState>((ref) {
  return LegalController(ref);
});

/// The public pages: the agreement, the privacy policy, account deletion.
///
/// Hindi pages live at the site root and English ones under `/en`, matching
/// the website's own routing.
abstract final class LegalLinks {
  const LegalLinks._();

  static Uri partnerTerms(String languageCode) =>
      _page(languageCode, 'partner-terms');

  static Uri privacy(String languageCode) => _page(languageCode, 'privacy');

  static Uri deleteAccount(String languageCode) =>
      _page(languageCode, 'delete-account');

  static Uri _page(String languageCode, String slug) {
    final base = Env.siteUrl.replaceFirst(RegExp(r'/+$'), '');
    final prefix = languageCode == 'hi' ? '' : '/en';
    return Uri.parse('$base$prefix/$slug');
  }

  /// Opens in the phone's browser, not inside the app — the person should
  /// be reading the real page, and be able to keep or share it.
  static Future<void> open(Uri uri) async {
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // No browser at all. Nothing useful to say that the person can act on.
    }
  }
}
