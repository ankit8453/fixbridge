import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:fixbridge_partner/core/api/api_error.dart';
import 'package:fixbridge_partner/core/providers.dart';
import 'package:fixbridge_partner/data/models/legal.dart';
import 'package:fixbridge_partner/data/repositories/legal_repository.dart';
import 'package:fixbridge_partner/features/legal/agreement_screen.dart';
import 'package:fixbridge_partner/features/legal/legal_controller.dart';
import 'package:fixbridge_partner/l10n/app_text.dart';
import 'package:fixbridge_partner/shared/widgets/app_button.dart';

/// The partner-agreement gate. Getting this wrong either lets somebody work
/// without having agreed, or locks a technician out of their own app.
void main() {
  group('legal status parsing', () {
    test('reads the full shape the API sends', () {
      final status = LegalStatus.fromJson({
        'customerTerms': {
          'currentVersion': '2026-11-15',
          'acceptedVersion': null,
          'acceptedAt': null,
          'accepted': false,
        },
        'partnerTerms': {
          'currentVersion': '2026-11-15',
          'acceptedVersion': '2026-11-15',
          'acceptedAt': '2026-11-15T10:00:00.000Z',
          'accepted': true,
        },
      });

      expect(status.partnerTerms.currentVersion, '2026-11-15');
      expect(status.partnerTerms.acceptedVersion, '2026-11-15');
      expect(status.partnerTerms.acceptedAt, '2026-11-15T10:00:00.000Z');
      expect(status.partnerTerms.accepted, isTrue);
      expect(status.customerTerms.accepted, isFalse);
    });

    test('nulls are read as nulls, and not accepted', () {
      final status = LegalStatus.fromJson({
        'partnerTerms': {
          'currentVersion': '2026-11-15',
          'acceptedVersion': null,
          'acceptedAt': null,
          'accepted': false,
        },
      });

      expect(status.partnerTerms.currentVersion, '2026-11-15');
      expect(status.partnerTerms.acceptedVersion, isNull);
      expect(status.partnerTerms.acceptedAt, isNull);
      expect(status.partnerTerms.accepted, isFalse);
    });

    test('a missing `accepted` is not accepted', () {
      final status = LegalStatus.fromJson({
        'partnerTerms': {
          'currentVersion': '2026-11-15',
          'acceptedVersion': '2026-11-15',
        },
      });
      expect(status.partnerTerms.accepted, isFalse);
    });

    test('only a literal true counts', () {
      for (final odd in ['true', 1, 'yes', null, <String, Object>{}]) {
        final status = LegalStatus.fromJson({
          'partnerTerms': {'currentVersion': 'v1', 'accepted': odd},
        });
        expect(status.partnerTerms.accepted, isFalse, reason: '$odd');
      }
    });

    test('odd types and missing blocks do not crash', () {
      final missing = LegalStatus.fromJson(const <String, Object>{});
      expect(missing.partnerTerms.accepted, isFalse);
      expect(missing.partnerTerms.currentVersion, isNull);

      final wrongTypes = LegalStatus.fromJson({
        'partnerTerms': {
          'currentVersion': 20261115,
          'acceptedVersion': ['x'],
          'acceptedAt': 5,
          'accepted': 'true',
        },
      });
      expect(wrongTypes.partnerTerms.currentVersion, isNull);
      expect(wrongTypes.partnerTerms.acceptedVersion, isNull);
      expect(wrongTypes.partnerTerms.acceptedAt, isNull);
      expect(wrongTypes.partnerTerms.accepted, isFalse);

      expect(LegalStatus.fromJson(null).partnerTerms.accepted, isFalse);
      expect(LegalStatus.fromJson('<html>').partnerTerms.accepted, isFalse);
      expect(
        LegalStatus.fromJson({'partnerTerms': 'yes'}).partnerTerms.accepted,
        isFalse,
      );
    });
  });

  group('legal links', () {
    test('Hindi pages sit at the root, English under /en', () {
      expect(
        LegalLinks.partnerTerms('hi').toString(),
        'https://www.fixbridge.me/partner-terms',
      );
      expect(
        LegalLinks.privacy('hi').toString(),
        'https://www.fixbridge.me/privacy',
      );
      expect(
        LegalLinks.deleteAccount('hi').toString(),
        'https://www.fixbridge.me/delete-account',
      );
      expect(
        LegalLinks.partnerTerms('en').toString(),
        'https://www.fixbridge.me/en/partner-terms',
      );
      expect(
        LegalLinks.privacy('en').toString(),
        'https://www.fixbridge.me/en/privacy',
      );
      expect(
        LegalLinks.deleteAccount('en').toString(),
        'https://www.fixbridge.me/en/delete-account',
      );
    });
  });

  group('the gate', () {
    test('never treats another account\'s answer as this one\'s', () {
      const state = LegalState(gate: LegalGate.accepted, userId: 'a');
      expect(state.gateFor('a'), LegalGate.accepted);
      expect(state.gateFor('b'), LegalGate.loading);
      expect(LegalState.idle.gateFor('a'), LegalGate.loading);
      expect(state.gateFor(null), LegalGate.idle);
    });

    test('accepting the version on screen opens the gate', () async {
      final repo = _FakeRepo()..acceptResult = _status('v1', accepted: true);
      final container = _container(repo, _required('v1'));
      addTearDown(container.dispose);

      await container.read(legalControllerProvider.notifier).accept();

      expect(repo.acceptedVersions, ['v1']);
      expect(container.read(legalControllerProvider).gate, LegalGate.accepted);
    });

    test('an outdated version refetches and keeps the screen', () async {
      final repo = _FakeRepo()
        ..acceptError = ApiError(
          code: ApiError.legalVersionOutdated,
          message: 'outdated',
          statusCode: 409,
        )
        ..statusResult = _status('v2', accepted: false);
      final container = _container(repo, _required('v1'));
      addTearDown(container.dispose);

      await container.read(legalControllerProvider.notifier).accept();

      final state = container.read(legalControllerProvider);
      expect(state.gate, LegalGate.required);
      expect(state.partner?.currentVersion, 'v2');
      expect(state.notice, LegalNotice.versionChanged);
      expect(state.submitting, isFalse);
    });

    test('a failed refetch is a failure, not a pass', () async {
      final repo = _FakeRepo()
        ..acceptError = ApiError(
          code: ApiError.legalVersionOutdated,
          message: 'outdated',
          statusCode: 409,
        )
        ..statusError = ApiError(
          code: ApiError.network,
          message: 'offline',
          statusCode: 0,
        );
      final container = _container(repo, _required('v1'));
      addTearDown(container.dispose);

      await container.read(legalControllerProvider.notifier).accept();

      expect(container.read(legalControllerProvider).gate, LegalGate.failed);
    });

    test('a body with no version cannot be accepted', () async {
      final repo = _FakeRepo()..statusResult = LegalStatus.empty;
      final container = _container(
        repo,
        const LegalState(gate: LegalGate.failed, userId: 'u1'),
      );
      addTearDown(container.dispose);

      await container.read(legalControllerProvider.notifier).retry();

      expect(container.read(legalControllerProvider).gate, LegalGate.failed);
    });
  });

  group('agreement screen', () {
    setUpAll(() {
      // No network in tests; the fallback faces are fine for layout.
      GoogleFonts.config.allowRuntimeFetching = false;
    });

    testWidgets('Accept stays disabled until the box is ticked',
        (tester) async {
      setAppLanguage('en');
      final repo = _FakeRepo();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            legalRepositoryProvider.overrideWithValue(repo),
            localeProvider.overrideWithValue(const Locale('en')),
            legalControllerProvider.overrideWith(
              (ref) => LegalController(
                ref,
                initial: _required('2026-11-15'),
                followAuth: false,
              ),
            ),
          ],
          child: const MaterialApp(home: AgreementScreen()),
        ),
      );
      await tester.pump();

      AppButton accept() =>
          tester.widget<AppButton>(find.byKey(const Key('legal.accept')));

      expect(find.text('Before you continue'), findsOneWidget);
      expect(find.text('Version 2026-11-15'), findsOneWidget);
      expect(accept().onPressed, isNull);

      await tester.ensureVisible(find.byKey(const Key('legal.agreeBox')));
      await tester.tap(find.byKey(const Key('legal.agreeBox')));
      await tester.pump();
      expect(accept().onPressed, isNotNull);

      // Unticking closes it again.
      await tester.tap(find.byKey(const Key('legal.agreeBox')));
      await tester.pump();
      expect(accept().onPressed, isNull);
    });

    testWidgets('a failed load offers Retry and Sign out, never Accept',
        (tester) async {
      setAppLanguage('en');

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            legalRepositoryProvider.overrideWithValue(_FakeRepo()),
            localeProvider.overrideWithValue(const Locale('en')),
            legalControllerProvider.overrideWith(
              (ref) => LegalController(
                ref,
                initial: const LegalState(gate: LegalGate.failed, userId: 'u1'),
                followAuth: false,
              ),
            ),
          ],
          child: const MaterialApp(home: AgreementScreen()),
        ),
      );
      await tester.pump();

      expect(
        find.text(
          'Could not load the agreement. Check your connection and try again.',
        ),
        findsOneWidget,
      );
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Sign out'), findsOneWidget);
      expect(find.byKey(const Key('legal.accept')), findsNothing);
    });
  });
}

LegalStatus _status(String version, {required bool accepted}) => LegalStatus(
      customerTerms: LegalDocStatus.empty,
      partnerTerms: LegalDocStatus(
        currentVersion: version,
        acceptedVersion: accepted ? version : null,
        acceptedAt: accepted ? '2026-11-15T10:00:00.000Z' : null,
        accepted: accepted,
      ),
    );

LegalState _required(String version) => LegalState(
      gate: LegalGate.required,
      userId: 'u1',
      partner: LegalDocStatus(
        currentVersion: version,
        acceptedVersion: null,
        acceptedAt: null,
        accepted: false,
      ),
    );

ProviderContainer _container(LegalRepository repo, LegalState initial) {
  return ProviderContainer(
    overrides: [
      legalRepositoryProvider.overrideWithValue(repo),
      legalControllerProvider.overrideWith(
        (ref) => LegalController(ref, initial: initial, followAuth: false),
      ),
    ],
  );
}

class _FakeRepo implements LegalRepository {
  LegalStatus statusResult = LegalStatus.empty;
  Object? statusError;
  LegalStatus? acceptResult;
  Object? acceptError;
  final acceptedVersions = <String>[];

  @override
  Future<LegalStatus> status() async {
    if (statusError != null) throw statusError!;
    return statusResult;
  }

  @override
  Future<LegalStatus> acceptPartnerTerms(String version) async {
    acceptedVersions.add(version);
    if (acceptError != null) throw acceptError!;
    return acceptResult ?? statusResult;
  }
}
