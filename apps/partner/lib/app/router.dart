import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../features/auth/auth_controller.dart';
import '../features/auth/language_screen.dart';
import '../features/auth/otp_screen.dart';
import '../features/auth/phone_screen.dart';

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
final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authControllerProvider);
  final localeChosen = ref.watch(localeChosenProvider);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/',
    redirect: (context, state) {
      final path = state.matchedLocation;

      if (auth.isStarting) {
        return path == '/splash' ? null : '/splash';
      }
      if (path == '/splash') {
        if (!localeChosen) return '/language';
        return switch (auth.stage) {
          AuthStage.signedIn => '/',
          AuthStage.needsRegistration => '/register',
          _ => '/signin',
        };
      }

      if (!localeChosen && path != '/language') return '/language';

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
