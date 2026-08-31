import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/providers.dart';
import 'core/storage/session_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Portrait only. Every screen here is a single column read one-handed;
  // landscape would buy nothing and cost a second layout to maintain.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Opened before the first frame so nothing downstream has to deal with an
  // async store — the language choice in particular is read synchronously
  // when the router decides its very first route.
  final store = await SessionStore.open();

  runApp(
    ProviderScope(
      overrides: [sessionStoreProvider.overrideWithValue(store)],
      child: const PartnerApp(),
    ),
  );
}
