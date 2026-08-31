import 'money.dart';

/// One itemised line on a quotation.
class QuotationItem {
  const QuotationItem({
    required this.id,
    required this.kind,
    required this.description,
    required this.qty,
    required this.unitPaise,
    required this.lineTotalPaise,
  });

  final String id;

  /// `part` or `labour_extra`.
  final String kind;

  final String description;
  final int qty;
  final int unitPaise;
  final int lineTotalPaise;

  bool get isPart => kind == 'part';

  /// "1 × ₹240" — shown under the description so the arithmetic is visible
  /// rather than asserted.
  String get unitLabel => '$qty × ${Paise.format(unitPaise)}';

  factory QuotationItem.fromJson(Map<String, dynamic> json) => QuotationItem(
        id: json['id'] as String? ?? '',
        kind: json['kind'] as String? ?? 'part',
        description: json['description'] as String? ?? '',
        qty: (json['qty'] as num?)?.toInt() ?? 1,
        unitPaise: asPaise(json['unitPaise'] ?? 0),
        lineTotalPaise: asPaise(json['lineTotalPaise'] ?? 0),
      );
}

/// A price the technician has sent, as one immutable version.
///
/// Quotations are never edited — a revision is a new version, enforced by
/// immutability triggers in the database. Both sides see the whole history,
/// because hiding a superseded version would let a technician quietly change
/// a number the customer had already seen, which is the exact behaviour the
/// feature exists to prevent.
class Quotation {
  const Quotation({
    required this.id,
    required this.bookingId,
    required this.version,
    required this.status,
    required this.labourPaise,
    required this.agreedLabourPaise,
    required this.extraLabourPaise,
    required this.extraLabourReason,
    required this.partsTotalPaise,
    required this.totalPaise,
    required this.totalDisplay,
    required this.note,
    required this.decisionNote,
    required this.items,
    required this.decidedAt,
    required this.createdAt,
  });

  final String id;
  final String bookingId;
  final int version;

  /// `sent`, `approved`, `rejected`, `superseded` or `withdrawn`.
  final String status;

  final int labourPaise;

  /// The labour agreed at booking time. **Derived from the booking snapshot
  /// server-side and never accepted from a client** — a technician cannot
  /// move this number by asking.
  final int? agreedLabourPaise;

  /// Work found on site, beyond the agreed anchor.
  final int? extraLabourPaise;

  /// Extra labour always travels with a written reason of at least ten
  /// characters. If [extraLabourPaise] is set, this is present — and the UI
  /// must show it verbatim, before the approve button.
  final String? extraLabourReason;

  final int partsTotalPaise;
  final int totalPaise;
  final String totalDisplay;

  final String? note;
  final String? decisionNote;
  final List<QuotationItem> items;
  final DateTime? decidedAt;
  final DateTime createdAt;

  /// Awaiting the customer's decision.
  bool get isPending => status == 'sent';
  bool get isApproved => status == 'approved';

  /// Whether to draw the extra-labour row and its reason card at all.
  bool get hasExtraLabour => extraLabourPaise != null && extraLabourPaise! > 0;

  List<QuotationItem> get parts => items.where((i) => i.isPart).toList();

  factory Quotation.fromJson(Map<String, dynamic> json) => Quotation(
        id: json['id'] as String? ?? '',
        bookingId: json['bookingId'] as String? ?? '',
        version: (json['version'] as num?)?.toInt() ?? 1,
        status: json['status'] as String? ?? 'sent',
        labourPaise: asPaise(json['labourPaise'] ?? 0),
        agreedLabourPaise: asPaiseOrNull(json['agreedLabourPaise']),
        extraLabourPaise: asPaiseOrNull(json['extraLabourPaise']),
        extraLabourReason: json['extraLabourReason'] as String?,
        partsTotalPaise: asPaise(json['partsTotalPaise'] ?? 0),
        totalPaise: asPaise(json['totalPaise'] ?? 0),
        totalDisplay: json['totalDisplay'] as String? ?? '',
        note: json['note'] as String?,
        decisionNote: json['decisionNote'] as String?,
        items: (json['items'] as List?)
                ?.map((i) =>
                    QuotationItem.fromJson((i as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
        decidedAt:
            DateTime.tryParse(json['decidedAt'] as String? ?? '')?.toLocal(),
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
      );
}

/// Every version of the price for one booking, plus the two that matter.
class QuotationHistory {
  const QuotationHistory({
    required this.bookingId,
    required this.quotations,
    required this.pending,
    required this.approved,
  });

  final String bookingId;
  final List<Quotation> quotations;
  final Quotation? pending;
  final Quotation? approved;

  factory QuotationHistory.fromJson(Map<String, dynamic> json) =>
      QuotationHistory(
        bookingId: json['bookingId'] as String? ?? '',
        quotations: (json['quotations'] as List?)
                ?.map((q) =>
                    Quotation.fromJson((q as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
        pending: json['pending'] == null
            ? null
            : Quotation.fromJson(
                (json['pending'] as Map).cast<String, dynamic>()),
        approved: json['approved'] == null
            ? null
            : Quotation.fromJson(
                (json['approved'] as Map).cast<String, dynamic>()),
      );
}
