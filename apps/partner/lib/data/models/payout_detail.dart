/// Where a technician's money goes.
///
/// The account number and PAN arrive **already masked** — the API never sends
/// them whole, not even back to the person they belong to. So this model has
/// nowhere to put a full number, which is deliberate: a field that does not
/// exist cannot be logged, cached in a crash report, or rendered on a screen
/// somebody is holding up in a shop.
class PayoutDetail {
  const PayoutDetail({
    required this.method,
    required this.accountNumberMasked,
    required this.ifsc,
    required this.accountHolder,
    required this.upiId,
    required this.panMasked,
  });

  /// `bank` or `upi`. Kept as a string rather than an enum so an unfamiliar
  /// value from a newer API does not throw on an older build.
  final String method;

  /// `••••••7890`, or null when paid by UPI.
  final String? accountNumberMasked;
  final String? ifsc;
  final String? accountHolder;

  /// Shown in full — it is not a secret, it is what you give somebody so they
  /// can pay you, and masking it would hide the one thing worth checking.
  final String? upiId;

  /// `ABCDE••••F`, or null when no PAN has been given.
  final String? panMasked;

  bool get isBank => method == 'bank';
  bool get hasPan => panMasked != null;

  /// The one line to show on the wallet: where the next payout lands.
  String get destination {
    if (isBank) {
      final tail = accountNumberMasked ?? '';
      return ifsc == null ? tail : '$tail · $ifsc';
    }
    return upiId ?? '';
  }

  /// Null rather than throwing when the field is absent — a technician who has
  /// not filled the form yet is a normal state, not an error, and the API
  /// answers 200 with null for exactly that reason.
  static PayoutDetail? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;

    final method = json['method'] as String?;
    if (method == null) return null;

    return PayoutDetail(
      method: method,
      accountNumberMasked: json['accountNumberMasked'] as String?,
      ifsc: json['ifsc'] as String?,
      accountHolder: json['accountHolder'] as String?,
      upiId: json['upiId'] as String?,
      panMasked: json['panMasked'] as String?,
    );
  }
}
