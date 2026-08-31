import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../features/auth/auth_controller.dart';
import '../features/auth/language_screen.dart';
import '../features/auth/name_screen.dart';
import '../features/auth/otp_screen.dart';
import '../features/auth/phone_screen.dart';
import '../features/home/home_screen.dart';
import '../features/shell/app_shell.dart';
import 'screens.dart';
import 'splash_screen.dart';

final _rootKey = GlobalKey<NavigatorState>();
final _shellKey = GlobalKey<NavigatorState>();

/// Routes.
///
/// The redirect rules are deliberately few. Browsing is public — categories,
/// search, profiles and slots all work with no session — so the only hard
/// gates are the language choice at the very start and the sign-in wall in
/// front of anything that writes.
final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authControllerProvider);
  final localeChosen = ref.watch(localeProvider.notifier).hasChosen;

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/',
    redirect: (context, state) {
      final path = state.matchedLocation;

      // Nothing can be decided until the stored session has been tried.
      if (auth.isStarting) {
        return path == '/splash' ? null : '/splash';
      }
      if (path == '/splash') {
        return localeChosen ? '/' : '/language';
      }

      // The language picker comes before everything, including the app's own
      // first screen — the app should never speak to somebody in a language
      // they were not asked about.
      if (!localeChosen && path != '/language') return '/language';

      // Straight out of a first sign-in, ask for a name once.
      if (auth.needsName && path != '/welcome') return '/welcome';

      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (_, __) => const SplashScreen(),
      ),
      GoRoute(
        path: '/language',
        builder: (_, __) => const LanguageScreen(),
      ),
      GoRoute(
        path: '/settings/language',
        builder: (_, __) => const LanguageScreen(isSettings: true),
      ),
      GoRoute(
        path: '/signin',
        builder: (_, state) => PhoneScreen(
          redirectTo: state.uri.queryParameters['redirect'],
        ),
        routes: [
          GoRoute(
            path: 'otp',
            builder: (_, state) => OtpScreen(
              redirectTo: state.uri.queryParameters['redirect'],
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/welcome',
        builder: (_, state) => NameScreen(
          redirectTo: state.uri.queryParameters['redirect'],
        ),
      ),

      // Full-screen routes that sit above the tab shell.
      GoRoute(
        path: '/search',
        parentNavigatorKey: _rootKey,
        builder: (_, state) => SearchScreen(
          categoryId: int.tryParse(state.uri.queryParameters['category'] ?? ''),
        ),
      ),
      GoRoute(
        path: '/provider/:id',
        parentNavigatorKey: _rootKey,
        // `category` carries the service the customer searched for, so the
        // profile books that service rather than whichever price card sorts
        // first. Without it a two-service technician is booked at the wrong
        // price.
        builder: (_, state) => ProviderScreen(
          providerId: state.pathParameters['id']!,
          categoryId: int.tryParse(state.uri.queryParameters['category'] ?? ''),
        ),
      ),
      GoRoute(
        path: '/booking/:id',
        parentNavigatorKey: _rootKey,
        builder: (_, state) =>
            BookingScreen(bookingId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/account/addresses',
        parentNavigatorKey: _rootKey,
        builder: (_, __) => const AddressesScreen(),
      ),
      GoRoute(
        path: '/account/complaints',
        parentNavigatorKey: _rootKey,
        builder: (_, __) => const ComplaintsScreen(),
      ),

      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => AppShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(
            navigatorKey: _shellKey,
            routes: [
              GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/bookings',
                builder: (_, __) => const BookingsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/notifications',
                builder: (_, __) => const NotificationsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/account',
                builder: (_, __) => const AccountScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

/// Sends somebody to sign in and back to where they were.
///
/// Used by every action that writes — booking, reviewing, complaining — so
/// that hitting the wall never loses the thing they were in the middle of.
void requireSignIn(BuildContext context, {String? then}) {
  final redirect = then ?? GoRouterState.of(context).uri.toString();
  context.push('/signin?redirect=${Uri.encodeComponent(redirect)}');
}
