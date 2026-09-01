import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/env.dart';
import '../shared/widgets/update_gate.dart';
import '../core/providers.dart';
import '../core/theme/app_theme.dart';
import '../features/auth/auth_controller.dart';
import 'router.dart';

class PartnerApp extends ConsumerStatefulWidget {
  const PartnerApp({super.key});

  @override
  ConsumerState<PartnerApp> createState() => _PartnerAppState();
}

class _PartnerAppState extends ConsumerState<PartnerApp> {
  @override
  void initState() {
    super.initState();
    // Trades the stored refresh token for a live session. Until this
    // resolves the router holds on the splash screen, so nothing renders
    // against a half-known auth state.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authControllerProvider.notifier).start();
    });
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final locale = ref.watch(localeProvider);

    return MaterialApp.router(
      title: Env.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      // Light only, deliberately — see AppTheme. Following the system into
      // dark would hand a customer a dark screen to read in a doorway at
      // midday, which is the one lighting condition this app must survive.
      themeMode: ThemeMode.light,
      routerConfig: router,
      locale: locale,
      supportedLocales: const [Locale('hi'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) {
        // Pins text scaling to a sane band. Honouring the system setting
        // matters — plenty of people run their phone at 130% — but past
        // about 1.3 the bill rows and the OTP tiles stop fitting, and a
        // clipped total is worse than slightly small type.
        final scale = MediaQuery.textScalerOf(context).clamp(
          minScaleFactor: 0.9,
          maxScaleFactor: 1.3,
        );
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: scale),
          // Wraps every route, so a build the API has retired cannot be used
          // by navigating past the screen that says so.
          child: UpdateGate(child: child ?? const SizedBox.shrink()),
        );
      },
    );
  }
}
