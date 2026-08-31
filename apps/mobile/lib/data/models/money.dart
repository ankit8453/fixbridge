import 'package:intl/intl.dart';

/// Money is integer paise on the wire, everywhere, without exception.
///
/// The API sends both halves of every amount: a `…Paise` integer and a
/// `…Display` string it formatted itself. **Render the display string.** It is
/// the server's own formatting, in the caller's locale, and re-deriving it on
/// the client is how the app and the receipt end up disagreeing about a bill.
///
/// [format] exists for the cases where only paise arrived — a computed
/// subtotal, a coupon preview — and never as a substitute for a display string
/// the response already contained.
class Paise {
  const Paise._();

  static final _rupees = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: 0,
  );

  static final _rupeesWithPaise = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: 2,
  );

  /// Whole rupees when the amount is whole, which it nearly always is here —
  /// "₹1,090" reads faster than "₹1,090.00" and this is a screen people scan.
  static String format(int paise) {
    if (paise % 100 == 0) return _rupees.format(paise ~/ 100);
    return _rupeesWithPaise.format(paise / 100);
  }

  /// Prefers the server's string and falls back to formatting the integer,
  /// so a response that omits the display half still renders something right.
  static String show(String? display, int? paise) {
    if (display != null && display.isNotEmpty) return display;
    if (paise != null) return format(paise);
    return '—';
  }
}

/// Reads an integer that may arrive as `int`, `double` or `String`.
/// Defensive on purpose: a money field silently becoming 0 is the worst
/// possible parse failure, so this throws rather than guessing.
int asPaise(Object? value) {
  if (value is int) return value;
  if (value is num) return value.round();
  if (value is String) {
    final parsed = int.tryParse(value);
    if (parsed != null) return parsed;
  }
  throw FormatException('Not a paise amount: $value');
}

int? asPaiseOrNull(Object? value) => value == null ? null : asPaise(value);
