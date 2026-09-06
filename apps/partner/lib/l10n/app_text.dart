import 'strings_en.dart';
import 'strings_hi.dart';

/// Every word the app says, in the language the customer chose.
///
/// Plain `const` maps rather than generated code or `.arb` files, for the same
/// reason the models are hand-written: `flutter pub get` and `flutter run` are
/// the whole setup, with no build step between them. The API and the website
/// already keep their copy in flat key/value files, so this is the third of
/// three that look alike rather than a fourth thing to learn.
///
/// ## Why a top-level function and not `context.tr(...)`
///
/// The obvious Flutter answer is a `Localizations` delegate read from a
/// `BuildContext`. It was tried first and abandoned: a great deal of this app's
/// copy lives where there is no context to read — the booking-status labels are
/// pure functions of an enum, the progress rail names its own steps, and
/// several sheets build their text in a `static` helper. Threading a context
/// into all of them would have meant reshaping working code to suit the
/// translation layer rather than the other way round.
///
/// So the language is process-wide state, set once at startup and again
/// whenever somebody changes it. That is safe here for a specific reason: the
/// only writer is [setAppLanguage], and a language change rebuilds the entire
/// widget tree immediately afterwards, so nothing can be left holding a
/// half-translated screen.
String _language = 'hi';

/// Called by the app when the locale is chosen, and on every change after.
void setAppLanguage(String code) {
  _language = code == 'hi' ? 'hi' : 'en';
}

/// The current language. Read by tests, and by nothing else.
String get appLanguage => _language;

/// `tr('booking.payNow')`, or `tr('otp.sentTo', {'phone': masked})`.
///
/// **A missing key never crashes and never renders blank.** It falls back to
/// English, then to the key itself — so an untranslated string looks wrong in a
/// way somebody will report, rather than vanishing quietly.
///
/// Placeholders are `{name}`, not `$name`: they have to survive being typed by
/// a translator into a plain text file, and a stray `$` in Hindi copy should
/// not mean anything.
String tr(String key, [Map<String, Object?>? args]) {
  final table = _language == 'hi' ? stringsHi : stringsEn;
  var text = table[key] ?? stringsEn[key] ?? key;

  if (args != null) {
    for (final entry in args.entries) {
      text = text.replaceAll('{${entry.key}}', '${entry.value}');
    }
  }

  return text;
}
