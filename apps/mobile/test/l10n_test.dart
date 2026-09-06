import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fixbridge/l10n/app_text.dart';
import 'package:fixbridge/l10n/strings_en.dart';
import 'package:fixbridge/l10n/strings_hi.dart';

/// The two tables have to stay in step, and nothing here checks itself.
///
/// A missing Hindi string does not crash — it falls back to English — which is
/// the right behaviour at runtime and exactly why it would otherwise go
/// unnoticed until a customer saw half a screen in the wrong language.
void main() {
  final placeholder = RegExp(r'\{(\w+)\}');

  Set<String> placeholdersIn(String text) =>
      placeholder.allMatches(text).map((m) => m.group(1)!).toSet();

  group('the string tables', () {
    test('every English key has Hindi', () {
      final missing = stringsEn.keys.where((k) => !stringsHi.containsKey(k)).toList()..sort();
      expect(missing, isEmpty, reason: 'untranslated: ${missing.join(', ')}');
    });

    test('no Hindi key has been left behind after its English was removed', () {
      final stale = stringsHi.keys.where((k) => !stringsEn.containsKey(k)).toList()..sort();
      expect(stale, isEmpty, reason: 'stale: ${stale.join(', ')}');
    });

    test('the placeholders match, name for name', () {
      /// The one that actually breaks a screen. `{amount}` translated as
      /// `{राशि}` renders the literal braces to a customer, and English
      /// fallback would not save it because the key exists.
      final wrong = <String>[];
      for (final entry in stringsEn.entries) {
        final hi = stringsHi[entry.key];
        if (hi == null) continue;
        if (!setEquals(placeholdersIn(entry.value), placeholdersIn(hi))) {
          wrong.add('${entry.key}: en${placeholdersIn(entry.value)} hi${placeholdersIn(hi)}');
        }
      }
      expect(wrong, isEmpty, reason: wrong.join('\n'));
    });

    test('nothing is blank', () {
      final blank = [
        ...stringsEn.entries.where((e) => e.value.trim().isEmpty).map((e) => 'en ${e.key}'),
        ...stringsHi.entries.where((e) => e.value.trim().isEmpty).map((e) => 'hi ${e.key}'),
      ];
      expect(blank, isEmpty);
    });

    test('no key is left holding a raw Dart interpolation', () {
      // `$name` would have survived extraction as a literal dollar and print
      // itself. Placeholders are `{name}` on both sides.
      final leaked = [
        ...stringsEn.entries.where((e) => e.value.contains(r'$')).map((e) => 'en ${e.key}'),
        ...stringsHi.entries.where((e) => e.value.contains(r'$')).map((e) => 'hi ${e.key}'),
      ];
      expect(leaked, isEmpty);
    });
  });

  group('lookup', () {
    test('answers in the chosen language', () {
      setAppLanguage('hi');
      expect(tr('shell.home'), stringsHi['shell.home']);
      setAppLanguage('en');
      expect(tr('shell.home'), stringsEn['shell.home']);
    });

    test('falls back to English rather than showing nothing', () {
      setAppLanguage('hi');
      // Proven with a key that exists in neither table: the key itself comes
      // back, which is visibly wrong on screen and gets reported.
      expect(tr('nothing.here.at.all'), 'nothing.here.at.all');
    });

    test('fills placeholders', () {
      setAppLanguage('en');
      expect(tr('bookings.todayTime', {'time': '4 pm'}), 'Today, 4 pm');
    });

    test('an unknown language is treated as English, not as a crash', () {
      setAppLanguage('ta');
      expect(appLanguage, 'en');
      expect(tr('shell.home'), stringsEn['shell.home']);
    });
  });
}
