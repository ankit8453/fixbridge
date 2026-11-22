import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:fixbridge/core/api/api_error.dart';
import 'package:fixbridge/core/providers.dart';
import 'package:fixbridge/data/models/auth.dart';
import 'package:fixbridge/data/models/legal.dart';
import 'package:fixbridge/data/repositories/legal_repository.dart';
import 'package:fixbridge/features/auth/auth_controller.dart';
import 'package:fixbridge/features/legal/legal_controller.dart';
import 'package:fixbridge/features/legal/legal_links.dart';
import 'package:fixbridge/features/legal/terms_screen.dart';
import 'package:fixbridge/l10n/app_text.dart';
import 'package:fixbridge/shared/widgets/app_button.dart';

/// The terms gate decides whether somebody gets into the app at all, so every
/// doubtful input has to land on "not accepted" — never on "let them through".
void main() {
  group('legal status parsing', () {
    test('reads the full shape', () {
      final s = LegalStatus.fromJson(const {
        'customerTerms': {
          'currentVersion': '2026-11-15',
          'acceptedVersion': '2026-11-15',
          'acceptedAt': '2026-11-15T10:00:00.000Z',
          'accepted': true,
        },
        'partnerTerms': {
          'currentVersion': '2026-11-15',
          'acceptedVersion': null,
          'acceptedAt': null,
          'accepted': false,
        },
      });

      expect(s.customerTerms.currentVersion, '2026-11-15');
      expect(s.customerTerms.acceptedVersion, '2026-11-15');
      expect(s.customerTerms.acceptedAt, '2026-11-15T10:00:00.000Z');
      expect(s.customerTerms.accepted, isTrue);
      expect(s.customerTerms.canAccept, isTrue);
      expect(s.partnerTerms.accepted, isFalse);
      expect(s.partnerTerms.acceptedVersion, isNull);
    });

    test('nulls are read as nothing accepted', () {
      final t = LegalStatus.fromJson(const {
        'customerTerms': {
          'currentVersion': '2026-11-15',
          'acceptedVersion': null,
          'acceptedAt': null,
          'accepted': false,
        },
      }).customerTerms;

      expect(t.accepted, isFalse);
      expect(t.acceptedVersion, isNull);
      expect(t.acceptedAt, isNull);
      expect(t.currentVersion, '2026-11-15');
    });

    test('a missing accepted flag is not consent', () {
      final t = LegalDocStatus.fromJson(const {
        'currentVersion': '2026-11-15',
        'acceptedVersion': '2026-11-15',
      });
      expect(t.accepted, isFalse);
    });

    test('anything but a literal true is not consent', () {
      for (final odd in ['true', 1, null, 'yes']) {
        final t = LegalDocStatus.fromJson({
          'currentVersion': '2026-11-15',
          'accepted': odd,
        });
        expect(t.accepted, isFalse, reason: 'accepted: $odd');
      }
    });

    test('a missing or malformed body does not crash', () {
      for (final body in [null, 'nope', 42, const <String, dynamic>{}]) {
        final s = LegalStatus.fromJson(body);
        expect(s.customerTerms.accepted, isFalse);
        expect(s.customerTerms.canAccept, isFalse);
      }

      final odd = LegalStatus.fromJson(const {
        'customerTerms': {'currentVersion': 7, 'acceptedAt': false},
        'partnerTerms': 'x',
      });
      expect(odd.customerTerms.currentVersion, '');
      expect(odd.customerTerms.acceptedAt, isNull);
      expect(odd.customerTerms.canAccept, isFalse);
      expect(odd.partnerTerms.accepted, isFalse);
    });
  });

  group('legal links', () {
    test('Hindi at the root, English under /en', () {
      expect(
        legalPageUri(LegalPage.terms, 'hi').toString(),
        'https://www.fixbridge.me/terms',
      );
      expect(
        legalPageUri(LegalPage.refund, 'en').toString(),
        'https://www.fixbridge.me/en/refund-policy',
      );
      expect(
        legalPageUri(LegalPage.deleteAccount, 'en').toString(),
        'https://www.fixbridge.me/en/delete-account',
      );
      expect(
        legalPageUri(LegalPage.privacy, 'hi').toString(),
        'https://www.fixbridge.me/privacy',
      );
    });
  });

  group('legal controller', () {
    late _FakeLegalRepository repo;
    late ProviderContainer container;

    setUp(() {
      repo = _FakeLegalRepository();
      container = ProviderContainer(
        overrides: [
          legalRepositoryProvider.overrideWithValue(repo),
          authControllerProvider.overrideWith((ref) => _TestAuth(ref)),
        ],
      );
      // Keep the gate (and through it the controller) alive, as the router does.
      container.listen(legalGateProvider, (_, __) {});
    });

    tearDown(() => container.dispose());

    _TestAuth auth() =>
        container.read(authControllerProvider.notifier) as _TestAuth;

    Future<void> settle() => Future<void>.delayed(Duration.zero);

    test('signed out, the gate is open and nothing is fetched', () async {
      await settle();
      expect(container.read(legalGateProvider), LegalGate.open);
      expect(repo.statusCalls, 0);
    });

    test('a sign-in holds the gate until the status answers', () async {
      final answer = Completer<LegalStatus>();
      repo.nextStatus = () => answer.future;

      auth().signInAs('u1');
      expect(container.read(legalGateProvider), LegalGate.pending);

      answer.complete(_status(accepted: false));
      await settle();
      expect(container.read(legalGateProvider), LegalGate.blocked);
      expect(container.read(legalControllerProvider).stage, LegalStage.required);
    });

    test('accepted is cached for the session, and forgotten on sign-out',
        () async {
      repo.nextStatus = () async => _status(accepted: true);

      auth().signInAs('u1');
      await settle();
      expect(container.read(legalGateProvider), LegalGate.open);

      // A name change re-emits the auth state for the same person.
      auth().rename('Asha');
      await settle();
      expect(repo.statusCalls, 1);

      auth().signOutNow();
      await settle();
      expect(container.read(legalControllerProvider).stage, LegalStage.idle);

      auth().signInAs('u2');
      await settle();
      expect(repo.statusCalls, 2);
    });

    test('a failed fetch blocks rather than letting anyone through', () async {
      repo.nextStatus = () async => throw ApiError(
            code: ApiError.network,
            message: 'offline',
            statusCode: 0,
          );

      auth().signInAs('u1');
      await settle();
      expect(container.read(legalControllerProvider).stage, LegalStage.failed);
      expect(container.read(legalGateProvider), LegalGate.blocked);

      repo.nextStatus = () async => _status(accepted: false);
      await container.read(legalControllerProvider.notifier).retry();
      expect(container.read(legalControllerProvider).stage, LegalStage.required);
    });

    test('accepting opens the gate', () async {
      repo.nextStatus = () async => _status(accepted: false);
      auth().signInAs('u1');
      await settle();

      repo.nextAccept = (_) async => _status(accepted: true);
      await container.read(legalControllerProvider.notifier).accept('2026-11-15');

      expect(repo.acceptedVersions, ['2026-11-15']);
      expect(container.read(legalGateProvider), LegalGate.open);
    });

    test('an outdated version refetches and keeps the screen up', () async {
      repo.nextStatus = () async => _status(accepted: false);
      auth().signInAs('u1');
      await settle();

      repo.nextAccept = (_) async => throw ApiError(
            code: LegalRepository.versionOutdatedCode,
            message: 'outdated',
            statusCode: 409,
          );
      repo.nextStatus = () async => _status(accepted: false, version: '2026-12-01');

      await container.read(legalControllerProvider.notifier).accept('2026-11-15');

      final state = container.read(legalControllerProvider);
      expect(state.stage, LegalStage.required);
      expect(state.termsChanged, isTrue);
      expect(state.terms.currentVersion, '2026-12-01');
      expect(container.read(legalGateProvider), LegalGate.blocked);
    });

    test('any other accept failure reaches the screen', () async {
      repo.nextStatus = () async => _status(accepted: false);
      auth().signInAs('u1');
      await settle();

      repo.nextAccept = (_) async => throw ApiError(
            code: 'INTERNAL_ERROR',
            message: 'boom',
            statusCode: 500,
          );

      await expectLater(
        container.read(legalControllerProvider.notifier).accept('2026-11-15'),
        throwsA(isA<ApiError>()),
      );
    });
  });

  group('terms screen', () {
    setUpAll(() {
      // Nothing to fetch fonts from in a test; the fallback face is fine.
      GoogleFonts.config.allowRuntimeFetching = false;
    });

    Future<List<String>> pump(
      WidgetTester tester, {
      LegalState? state,
      String language = 'en',
    }) async {
      setAppLanguage(language);
      final accepted = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: TermsView(
            state: state ??
                LegalState(
                  stage: LegalStage.required,
                  terms: _status(accepted: false).customerTerms,
                ),
            onAccept: (v) async => accepted.add(v),
            onRetry: () {},
            onSignOut: () {},
            onOpenPage: (_) {},
          ),
        ),
      );
      return accepted;
    }

    VoidCallback? acceptHandler(WidgetTester tester) =>
        tester.widget<AppButton>(find.byKey(TermsView.acceptKey)).onPressed;

    testWidgets('accept stays disabled until the box is ticked',
        (tester) async {
      final accepted = await pump(tester);

      expect(find.text('Before you continue'), findsOneWidget);
      expect(find.text('Version 2026-11-15'), findsOneWidget);
      expect(acceptHandler(tester), isNull);

      await tester.tap(find.byKey(TermsView.acceptKey));
      await tester.pump();
      expect(accepted, isEmpty);

      await tester.tap(find.byKey(TermsView.checkboxKey));
      await tester.pump();
      expect(acceptHandler(tester), isNotNull);

      await tester.ensureVisible(find.byKey(TermsView.acceptKey));
      await tester.tap(find.byKey(TermsView.acceptKey));
      await tester.pump();
      expect(accepted, ['2026-11-15']);
    });

    testWidgets('a failed load offers retry and sign out, not the terms',
        (tester) async {
      await pump(
        tester,
        state: const LegalState(stage: LegalStage.failed),
      );

      expect(
        find.text('Could not load the terms. Check your connection and try again.'),
        findsOneWidget,
      );
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Sign out'), findsOneWidget);
      expect(find.byKey(TermsView.acceptKey), findsNothing);
    });

    testWidgets('speaks Hindi, and says when the terms changed',
        (tester) async {
      await pump(
        tester,
        language: 'hi',
        state: LegalState(
          stage: LegalStage.required,
          terms: _status(accepted: false).customerTerms,
          termsChanged: true,
        ),
      );

      expect(find.text('आगे बढ़ने से पहले'), findsOneWidget);
      expect(
        find.text('शर्तें अभी बदली गई हैं — कृपया इन्हें दोबारा देखें।'),
        findsOneWidget,
      );
      setAppLanguage('en');
    });
  });
}

LegalStatus _status({required bool accepted, String version = '2026-11-15'}) {
  return LegalStatus.fromJson({
    'customerTerms': {
      'currentVersion': version,
      'acceptedVersion': accepted ? version : null,
      'acceptedAt': accepted ? '2026-11-15T10:00:00.000Z' : null,
      'accepted': accepted,
    },
    'partnerTerms': {'currentVersion': version, 'accepted': false},
  });
}


class _FakeLegalRepository implements LegalRepository {
  Future<LegalStatus> Function() nextStatus =
      () async => _status(accepted: false);
  Future<LegalStatus> Function(String version) nextAccept =
      (_) async => _status(accepted: true);

  int statusCalls = 0;
  final acceptedVersions = <String>[];

  @override
  Future<LegalStatus> status() {
    statusCalls++;
    return nextStatus();
  }

  @override
  Future<LegalStatus> acceptCustomerTerms(String version) {
    acceptedVersions.add(version);
    return nextAccept(version);
  }
}

/// An auth controller whose session is set directly, with no network.
class _TestAuth extends AuthController {
  _TestAuth(super.ref) {
    state = const AuthState(stage: AuthStage.signedOut);
  }

  void signInAs(String id) {
    state = AuthState(
      stage: AuthStage.signedIn,
      user: AuthUser.fromJson({'id': id, 'phone': '+9198765*****'}),
    );
  }

  void rename(String name) {
    state = state.copyWith(user: state.user!.withName(name));
  }

  void signOutNow() {
    state = const AuthState(stage: AuthStage.signedOut);
  }
}
