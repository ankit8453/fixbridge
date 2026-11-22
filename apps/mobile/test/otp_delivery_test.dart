import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:fixbridge/data/models/auth.dart';
import 'package:fixbridge/features/auth/auth_controller.dart';
import 'package:fixbridge/features/auth/otp_screen.dart';
import 'package:fixbridge/l10n/app_text.dart';

/// During the pilot the team sends sign-in codes by hand on WhatsApp. The OTP
/// screen has to say so, or people wait for an SMS that never comes — and it
/// has to go back to the normal text the moment the server says delivery is
/// automatic again, including when an older server says nothing at all.
void main() {
  group('otp/request delivery parsing', () {
    OtpChallenge parse(Map<String, dynamic> extra) => OtpChallenge.fromJson({
          'phone': '+9199999*****',
          'expiresInSeconds': 900,
          'message': 'ok',
          ...extra,
        });

    test('team_relay is read as the team sending it', () {
      final c = parse({'delivery': 'team_relay'});
      expect(c.delivery, OtpDelivery.teamRelay);
      expect(c.maskedPhone, '+9199999*****');
      expect(c.expiresInSeconds, 900);
    });

    test('automatic is automatic', () {
      expect(parse({'delivery': 'automatic'}).delivery, OtpDelivery.automatic);
    });

    test('a missing field (older server) is automatic', () {
      expect(parse({}).delivery, OtpDelivery.automatic);
    });

    test('null is automatic', () {
      expect(parse({'delivery': null}).delivery, OtpDelivery.automatic);
    });

    test('anything unrecognised is automatic, and never throws', () {
      for (final garbage in <Object>[
        'TEAM_RELAY',
        'team-relay',
        'sms',
        '',
        42,
        true,
        const ['team_relay'],
        const {'mode': 'team_relay'},
      ]) {
        expect(
          parse({'delivery': garbage}).delivery,
          OtpDelivery.automatic,
          reason: 'delivery: $garbage',
        );
      }
    });
  });

  group('the line under "Enter the code"', () {
    tearDown(() => setAppLanguage('en'));

    test('team relay says the team will send it on WhatsApp, in English', () {
      setAppLanguage('en');
      expect(
        otpSentToText(
          masked: '+9199999*****',
          delivery: OtpDelivery.teamRelay,
          expiresInSeconds: 900,
        ),
        'Our team will send your code to +9199999***** on WhatsApp within a '
        'few minutes (9 am – 8 pm). The code is valid for 15 minutes.',
      );
    });

    test('and in Hindi', () {
      setAppLanguage('hi');
      expect(
        otpSentToText(
          masked: '+9199999*****',
          delivery: OtpDelivery.teamRelay,
          expiresInSeconds: 900,
        ),
        'हमारी टीम कुछ ही मिनटों में (सुबह 9 से रात 8 बजे तक) +9199999***** पर '
        'WhatsApp से आपका कोड भेजेगी। कोड 15 मिनट तक मान्य रहेगा।',
      );
    });

    test('minutes are rounded, and never below one', () {
      setAppLanguage('en');
      String text(int seconds) => otpSentToText(
            masked: 'x',
            delivery: OtpDelivery.teamRelay,
            expiresInSeconds: seconds,
          );

      expect(text(300), contains('valid for 5 minutes'));
      expect(text(330), contains('valid for 6 minutes'));
      expect(text(320), contains('valid for 5 minutes'));
      expect(text(20), contains('valid for 1 minutes'));
      expect(text(0), contains('valid for 1 minutes'));
    });

    test('automatic keeps the original text', () {
      setAppLanguage('en');
      expect(
        otpSentToText(
          masked: '+9199999*****',
          delivery: OtpDelivery.automatic,
          expiresInSeconds: 900,
        ),
        'Sent to +9199999*****',
      );
    });
  });

  group('OTP screen', () {
    setUpAll(() {
      // Nothing to fetch fonts from in a test; the fallback face is fine.
      GoogleFonts.config.allowRuntimeFetching = false;
    });

    Future<void> pump(WidgetTester tester, OtpDelivery delivery) async {
      setAppLanguage('en');
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(
              (ref) => _FakeAuth(ref, delivery: delivery),
            ),
          ],
          child: const MaterialApp(home: OtpScreen()),
        ),
      );
      await tester.pump();
    }

    /// The resend countdown is a periodic timer; take the screen down so the
    /// test does not end with it still pending.
    Future<void> unmount(WidgetTester tester) =>
        tester.pumpWidget(const SizedBox());

    testWidgets('shows the team-relay text when the team is sending codes',
        (tester) async {
      await pump(tester, OtpDelivery.teamRelay);

      expect(
        find.text(
          'Our team will send your code to +9199999***** on WhatsApp within '
          'a few minutes (9 am – 8 pm). The code is valid for 15 minutes.',
        ),
        findsOneWidget,
      );
      expect(find.text('Sent to +9199999*****'), findsNothing);

      await unmount(tester);
    });

    testWidgets('shows the original text when delivery is automatic',
        (tester) async {
      await pump(tester, OtpDelivery.automatic);

      expect(find.text('Sent to +9199999*****'), findsOneWidget);
      expect(find.textContaining('WhatsApp'), findsNothing);

      await unmount(tester);
    });
  });
}

class _FakeAuth extends AuthController {
  _FakeAuth(super.ref, {required this.delivery}) {
    state = const AuthState(stage: AuthStage.signedOut);
  }

  final OtpDelivery delivery;

  @override
  String? get maskedPhone => '+9199999*****';

  @override
  OtpDelivery get otpDelivery => delivery;

  @override
  int get otpExpiresInSeconds => 900;
}
