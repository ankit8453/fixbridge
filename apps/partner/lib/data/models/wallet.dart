import 'money.dart';

/// A transfer that has been made, or is waiting to be.
class Payout {
  const Payout({
    required this.id,
    required this.amountPaise,
    required this.amountDisplay,
    required this.status,
    required this.utrRef,
    required this.paidAt,
    required this.createdAt,
  });

  final String id;
  final int amountPaise;
  final String amountDisplay;

  /// `pending`, `paid` or `failed`.
  final String status;

  /// The bank reference, typed in by hand once the transfer is made. Present
  /// only on a `paid` payout, and worth showing — it is what a technician
  /// checks their passbook against.
  final String? utrRef;

  final DateTime? paidAt;
  final DateTime createdAt;

  bool get isPaid => status == 'paid';

  /// A failed payout posts nothing; the balance was already correct and rolls
  /// into the next batch. Worth saying so rather than leaving it as a scare.
  bool get isFailed => status == 'failed';

  factory Payout.fromJson(Map<String, dynamic> json) => Payout(
        id: json['id'] as String? ?? '',
        amountPaise: asPaise(json['amountPaise'] ?? 0),
        amountDisplay: json['amountDisplay'] as String? ?? '',
        status: json['status'] as String? ?? 'pending',
        utrRef: json['utrRef'] as String?,
        paidAt: DateTime.tryParse(json['paidAt'] as String? ?? '')?.toLocal(),
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
      );
}

/// One line of the technician's own ledger.
class LedgerLine {
  const LedgerLine({
    required this.journalId,
    required this.journalType,
    required this.accountType,
    required this.direction,
    required this.amountPaise,
    required this.amountDisplay,
    required this.bookingId,
    required this.createdAt,
  });

  final String journalId;
  final String journalType;
  final String accountType;

  /// `debit` or `credit`.
  final String direction;

  final int amountPaise;
  final String amountDisplay;
  final String? bookingId;
  final DateTime createdAt;

  /// Plain words for a line item. The journal type is an accounting term and
  /// a technician should never have to learn one to read their own wallet.
  String get label => switch (journalType) {
        'booking_settlement' => 'Job completed',
        'cash_commission' => 'Commission on cash job',
        'payout' => 'Paid out to you',
        'dues_settlement' => 'Dues cleared',
        'refund' => 'Refund to customer',
        _ => journalType.replaceAll('_', ' '),
      };

  factory LedgerLine.fromJson(Map<String, dynamic> json) => LedgerLine(
        journalId: json['journalId'] as String? ?? '',
        journalType: json['journalType'] as String? ?? '',
        accountType: json['accountType'] as String? ?? '',
        direction: json['direction'] as String? ?? 'credit',
        amountPaise: asPaise(json['amountPaise'] ?? 0),
        amountDisplay: json['amountDisplay'] as String? ?? '',
        bookingId: json['bookingId'] as String?,
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
      );
}

/// The money screen.
///
/// Payable and dues are shown **separately and never netted**. "We owe you
/// ₹4,000, you owe us ₹600" is something a technician can check against their
/// own week; a single "₹3,400" is not. Payouts are never reduced by dues
/// either — the first time somebody sees a smaller transfer than they expected
/// is the last time they trust this screen.
class Wallet {
  const Wallet({
    required this.payablePaise,
    required this.payableDisplay,
    required this.duesPaise,
    required this.duesDisplay,
    required this.netPaise,
    required this.pendingPayoutPaise,
    required this.payoutMinimumPaise,
    required this.recentPayouts,
    required this.ledger,
  });

  /// What the platform owes the technician.
  final int payablePaise;
  final String payableDisplay;

  /// What the technician owes the platform — commission on cash jobs, where
  /// the gross went hand to hand and never passed through our books.
  final int duesPaise;
  final String duesDisplay;

  /// payable − dues. **Negative means they owe more than they are owed.**
  final int netPaise;

  final int pendingPayoutPaise;

  /// A balance below this rolls over rather than being transferred.
  final int payoutMinimumPaise;

  final List<Payout> recentPayouts;
  final List<LedgerLine> ledger;

  bool get owesUs => netPaise < 0;

  /// The API's own `netDisplay` is absolute-valued — the sign is stripped —
  /// so rendering it alone on a negative balance shows a positive figure and
  /// is flatly wrong. Formatted here from [netPaise] instead.
  String get netDisplay => Paise.format(netPaise.abs());

  bool get belowMinimum =>
      payablePaise > 0 && payablePaise < payoutMinimumPaise;

  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(
        payablePaise: asPaise(json['payablePaise'] ?? 0),
        payableDisplay: json['payableDisplay'] as String? ?? '',
        duesPaise: asPaise(json['duesPaise'] ?? 0),
        duesDisplay: json['duesDisplay'] as String? ?? '',
        netPaise: asPaise(json['netPaise'] ?? 0),
        pendingPayoutPaise: asPaise(json['pendingPayoutPaise'] ?? 0),
        payoutMinimumPaise: asPaise(json['payoutMinimumPaise'] ?? 0),
        recentPayouts: (json['recentPayouts'] as List?)
                ?.map(
                    (p) => Payout.fromJson((p as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
        ledger: (json['ledger'] as List?)
                ?.map((l) =>
                    LedgerLine.fromJson((l as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
      );
}
