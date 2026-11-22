import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../features/auth/auth_controller.dart';
import '../features/auth/language_screen.dart';
import '../features/auth/otp_screen.dart';
import '../features/auth/phone_screen.dart';
import '../features/legal/agreement_screen.dart';
import '../features/legal/legal_controller.dart';

import '../features/shell/app_shell.dart';
import 'screens.dart';
import 'register_screen.dart';
import 'splash_screen.dart';

final _rootKey = GlobalKey<NavigatorState>();
final _shellKey = GlobalKey<NavigatorState>();

/// Routes.
///
/// Stricter than the customer app's. There is nothing to browse here — every
/// screen is about *this* technician's work — so the whole app sits behind
/// sign-in, and behind holding the technician role.
///
/// And behind the partner agreement: anyone with a session who has not
/// accepted the current version is held on `/agreement` — ahead of
/// registration and setup — until they do. See LegalController.
final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authControllerProvider);
  final localeChosen = ref.watch(localeChosenProvider);

  // The agreement gate re-runs the redirect rather than rebuilding the router,
  // so a technician on `/agreement` is not thrown back to `/` and re-routed
  // every time its state moves (Retry, a 409, the accept itself).
  final legalChanged = ValueNotifier<int>(0);
  ref.listen<LegalState>(
    legalControllerProvider,
    (_, __) => legalChanged.value++,
  );
  var disposed = false;
  ref.onDispose(() {
    disposed = true;
    legalChanged.dispose();
  });

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/',
    refreshListenable: legalChanged,
    redirect: (context, state) {
      final path = state.matchedLocation;

      if (auth.isStarting) {
        return path == '/splash' ? null : '/splash';
      }

      // Only for the router built for the auth state that is current. One
      // built for an older state is about to be replaced and should not act
      // on a gate that already belongs to the next session.
      final hasSession = auth.stage == AuthStage.signedIn ||
          auth.stage == AuthStage.needsRegistration;
      final legalGate =
          hasSession &&
                  !disposed &&
                  identical(ref.read(authControllerProvider), auth)
              ? ref.read(legalControllerProvider).gateFor(auth.user?.id)
              : null;

      // Finding out whether the agreement is accepted: hold on the splash,
      // as for the session itself. Left alone on `/agreement`, which shows
      // its own progress and a way to sign out.
      if (legalGate == LegalGate.loading && path != '/agreement') {
        return path == '/splash' ? null : '/splash';
      }

      if (path == '/splash') {
        if (!localeChosen) return '/language';
        if (legalGate == LegalGate.required || legalGate == LegalGate.failed) {
          return '/agreement';
        }
        return switch (auth.stage) {
          AuthStage.signedIn => '/',
          AuthStage.needsRegistration => '/register',
          _ => '/signin',
        };
      }

      if (!localeChosen && path != '/language') return '/language';

      // Not accepted, or could not be checked: nothing else exists until it
      // is. A failure is never a pass.
      if (legalGate == LegalGate.required || legalGate == LegalGate.failed) {
        if (path == '/agreement') return null;
        final from = state.uri.toString();
        return from == '/'
            ? '/agreement'
            : Uri(path: '/agreement', queryParameters: {'from': from})
                .toString();
      }
      if (legalGate == LegalGate.accepted && path == '/agreement') {
        // On to wherever they were headed; registration and the rest of the
        // rules below still apply on the next pass.
        final from = state.uri.queryParameters['from'];
        final valid = from != null &&
            from.startsWith('/') &&
            !from.startsWith('/agreement') &&
            !from.startsWith('/splash');
        return valid ? from : '/';
      }

      // Signed in but not a technician yet: registration is the only screen
      // that exists for them, because every other route would 403.
      if (auth.stage == AuthStage.needsRegistration && path != '/register') {
        return '/register';
      }

      final onAuthScreen = path.startsWith('/signin') || path == '/language';
      if (auth.stage == AuthStage.signedOut && !onAuthScreen) {
        return '/signin';
      }
      if (auth.isSignedIn && path.startsWith('/signin')) return '/';

      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/language', builder: (_, __) => const LanguageScreen()),
      GoRoute(
        path: '/settings/language',
        builder: (_, __) => const LanguageScreen(isSettings: true),
      ),
      GoRoute(
        path: '/signin',
        builder: (_, __) => const PhoneScreen(),
        routes: [
          GoRoute(path: 'otp', builder: (_, __) => const OtpScreen()),
        ],
      ),
      GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
      GoRoute(
        path: '/agreement',
        builder: (_, __) => const AgreementScreen(),
      ),
      GoRoute(
        path: '/job/:id',
        parentNavigatorKey: _rootKey,
        builder: (_, state) =>
            JobScreen(bookingId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/setup',
        parentNavigatorKey: _rootKey,
        builder: (_, __) => const SetupScreen(),
      ),
      GoRoute(
        path: '/calendar',
        parentNavigatorKey: _rootKey,
        builder: (_, __) => const CalendarScreen(),
      ),
      GoRoute(
        path: '/verification/:level',
        parentNavigatorKey: _rootKey,
        // `case` is present when answering an ops request for more, which
        // uses the same screen but a different endpoint.
        builder: (_, state) => VerificationScreen(
          level: int.tryParse(state.pathParameters['level'] ?? '') ?? 0,
          caseId: state.uri.queryParameters['case'],
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => AppShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(
            navigatorKey: _shellKey,
            routes: [
              GoRoute(path: '/', builder: (_, __) => const HomeScreen())
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/jobs', builder: (_, __) => const JobsScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                  path: '/wallet', builder: (_, __) => const WalletScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (_, __) => const ProfileScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});
