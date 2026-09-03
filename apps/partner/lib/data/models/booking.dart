import 'money.dart';
import 'quotation.dart';

/// Where a booking is, as the API's projection reports it.
///
/// The server's event log is the truth and `bookings.status` is a projection
/// of it; this enum mirrors that projection exactly. Six of the eleven are
/// terminal — nothing follows them, and the UI must stop polling on them.
enum BookingStatus {
  requested,
  accepted,
  rejected,
  expired,
  enRoute,
  arrived,
  inProgress,
  workDone,
  cancelledByCustomer,
  cancelledByProvider,
  closedQuoteDeclined,
  unknown;

  static BookingStatus parse(String? raw) => switch (raw) {
        'REQUESTED' => BookingStatus.requested,
        'ACCEPTED' => BookingStatus.accepted,
        'REJECTED' => BookingStatus.rejected,
        'EXPIRED' => BookingStatus.expired,
        'EN_ROUTE' => BookingStatus.enRoute,
        'ARRIVED' => BookingStatus.arrived,
        'IN_PROGRESS' => BookingStatus.inProgress,
        'WORK_DONE' => BookingStatus.workDone,
        'CANCELLED_BY_CUSTOMER' => BookingStatus.cancelledByCustomer,
        'CANCELLED_BY_PROVIDER' => BookingStatus.cancelledByProvider,
        'CLOSED_QUOTE_DECLINED' => BookingStatus.closedQuoteDeclined,
        _ => BookingStatus.unknown,
      };

  /// Nothing follows. Stop polling; there will never be another change.
  bool get isTerminal => switch (this) {
        BookingStatus.rejected ||
        BookingStatus.expired ||
        BookingStatus.workDone ||
        BookingStatus.cancelledByCustomer ||
        BookingStatus.cancelledByProvider ||
        BookingStatus.closedQuoteDeclined =>
          true,
        _ => false,
      };

  /// A job that is happening right now — the app polls faster and the home
  /// screen shows the live card.
  bool get isLive => switch (this) {
        BookingStatus.requested ||
        BookingStatus.accepted ||
        BookingStatus.enRoute ||
        BookingStatus.arrived ||
        BookingStatus.inProgress =>
          true,
        _ => false,
      };

  /// Where the money is settled and a payment can be started.
  bool get isBillable =>
      this == BookingStatus.workDone ||
      this == BookingStatus.closedQuoteDeclined;

  /// **Nothing cancels after ARRIVED.** Once the technician is at the door,
  /// "I changed my mind" is a dispute, not a cancellation — so the button has
  /// to disappear rather than sit there and fail.
  bool get canCustomerCancel => switch (this) {
        BookingStatus.requested ||
        BookingStatus.accepted ||
        BookingStatus.enRoute =>
          true,
        _ => false,
      };

  /// A complaint is possible from the moment somebody actually turned up.
  bool get canComplain => switch (this) {
        BookingStatus.arrived ||
        BookingStatus.inProgress ||
        BookingStatus.workDone ||
        BookingStatus.closedQuoteDeclined =>
          true,
        _ => false,
      };

  /// Position on the six-bead progress rail. Terminal failures sit off it.
  int get stageIndex => switch (this) {
        BookingStatus.requested => 0,
        BookingStatus.accepted => 1,
        BookingStatus.enRoute => 2,
        BookingStatus.arrived => 3,
        BookingStatus.inProgress => 4,
        BookingStatus.workDone => 5,
        _ => -1,
      };
}

/// One entry in the booking's own history.
class BookingEvent {
  const BookingEvent({
    required this.id,
    required this.eventType,
    required this.actorType,
    required this.createdAt,
    this.payload,
  });

  final String id;

  /// Includes non-transitioning kinds — `otp_failed`, `quote_sent` — which
  /// are recorded as evidence without moving the status.
  final String eventType;

  /// `customer`, `provider`, `system` or `ops`.
  final String actorType;

  final DateTime createdAt;
  final Map<String, dynamic>? payload;

  factory BookingEvent.fromJson(Map<String, dynamic> json) => BookingEvent(
        id: json['id'] as String? ?? '',
        eventType: json['eventType'] as String? ?? '',
        actorType: json['actorType'] as String? ?? 'system',
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
        payload: (json['payload'] as Map?)?.cast<String, dynamic>(),
      );
}

/// The other party, with the masking the API applies.
class Counterpart {
  const Counterpart({
    required this.name,
    required this.phone,
    required this.phoneRevealed,
    required this.photoUrl,
  });

  final String? name;

  /// Masked until the booking is ACCEPTED, full afterwards. Both sides
  /// genuinely need to call each other once a visit is agreed.
  final String? phone;

  final bool phoneRevealed;

  /// A short-lived signed URL, customer side only, from ACCEPTED onward.
  /// Null when the technician has not uploaded a photo.
  final String? photoUrl;

  /// In **this** app the counterpart is always the customer, never a
  /// technician — the technician is the person holding the phone. The fallback
  /// said "Technician", so a booking whose customer name came back empty
  /// rendered "Waiting for Technician to approve" on the technician's own
  /// screen, which read as the quote having been sent to the wrong person.
  String get displayName => name ?? 'the customer';

  factory Counterpart.fromJson(Map<String, dynamic>? json) => Counterpart(
        name: json?['name'] as String?,
        phone: json?['phone'] as String?,
        phoneRevealed: json?['phoneRevealed'] as bool? ?? false,
        photoUrl: json?['photoUrl'] as String?,
      );
}

/// The address as it was when the booking was made.
class BookingAddress {
  const BookingAddress({
    required this.addressText,
    required this.landmark,
    required this.label,
  });

  final String addressText;
  final String? landmark;
  final String? label;

  static BookingAddress? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final json = raw.cast<String, dynamic>();
    return BookingAddress(
      addressText: json['addressText'] as String? ?? '',
      landmark: json['landmark'] as String?,
      label: json['label'] as String?,
    );
  }
}

/// The rate the customer booked on, snapshotted at creation and never
/// recomputed. This is the number the quotation rules hold labour to.
class AgreedLabour {
  const AgreedLabour({required this.priceType, required this.amountPaise});

  final String? priceType;
  final int? amountPaise;

  bool get isFixed => priceType == 'fixed';

  factory AgreedLabour.fromJson(Map<String, dynamic>? json) => AgreedLabour(
        priceType: json?['priceType'] as String?,
        amountPaise: asPaiseOrNull(json?['amountPaise']),
      );
}

/// A booking, in full. The app's centre of gravity — this one object drives
/// eleven different shapes of the detail screen.
/// How this bill is being settled, as far as anyone has said.
///
/// One state rather than a set of flags. "Unpaid, cash chosen, paid" are
/// mutually exclusive, and a screen driven by independent booleans eventually
/// shows two of them at once — which is exactly how a customer ended up being
/// offered "Pay now" on a job the technician had already collected cash for.
enum SettlementState {
  /// No bill frozen yet, or nothing was owed.
  nothingDue,

  /// A bill exists and the customer has not picked how to pay.
  awaitingChoice,

  /// The customer chose cash. The technician has not confirmed holding it.
  cashChosen,

  /// A gateway order is open and unpaid.
  onlinePending,

  /// Settled, by either rail.
  paid,
}

class Settlement {
  const Settlement({required this.state, this.method, this.paidAt});

  final SettlementState state;

  /// `online`, `cash`, or null before anyone has chosen.
  final String? method;
  final DateTime? paidAt;

  bool get isPaid => state == SettlementState.paid;
  bool get wasCash => method == 'cash';

  /// True only while the technician's confirmation is the missing step. The
  /// one condition under which they are offered a payment action at all.
  bool get awaitsTechnician => state == SettlementState.cashChosen;

  static const nothingDue = Settlement(state: SettlementState.nothingDue);

  /// Falls back to [nothingDue] when the field is absent, so an older API
  /// leaves both apps quiet rather than offering the wrong button.
  static Settlement fromJson(Map<String, dynamic>? json) {
    if (json == null) return nothingDue;

    return Settlement(
      state: switch (json['state'] as String?) {
        'awaiting_choice' => SettlementState.awaitingChoice,
        'cash_chosen' => SettlementState.cashChosen,
        'online_pending' => SettlementState.onlinePending,
        'paid' => SettlementState.paid,
        _ => SettlementState.nothingDue,
      },
      method: json['method'] as String?,
      paidAt: DateTime.tryParse(json['paidAt'] as String? ?? '')?.toLocal(),
    );
  }
}

class Booking {
  const Booking({
    required this.id,
    required this.status,
    required this.categoryId,
    required this.startsAt,
    required this.endsAt,
    required this.problemNote,
    required this.visitFeePaise,
    required this.agreedLabour,
    required this.quotations,
    required this.pendingQuotation,
    required this.approvedQuotation,
    required this.payablePaise,
    required this.payable,
    required this.settlement,
    required this.address,
    required this.counterpart,
    required this.startOtp,
    required this.endOtp,
    required this.events,
    required this.createdAt,
  });

  final String id;
  final BookingStatus status;
  final int categoryId;
  final DateTime startsAt;
  final DateTime endsAt;
  final String? problemNote;

  /// What turning up costs. Whether it is actually charged is decided at the
  /// end — waived when the job was done under an approved quotation.
  final int visitFeePaise;

  final AgreedLabour agreedLabour;
  final List<Quotation> quotations;

  /// Awaiting the customer's decision. When this is non-null the detail
  /// screen leads with the approval card.
  final Quotation? pendingQuotation;

  final Quotation? approvedQuotation;

  /// Frozen at the terminal transition; null before then.
  final int? payablePaise;
  final Payable? payable;

  /// Where the money is. Drives every payment control on both sides.
  final Settlement settlement;

  final BookingAddress? address;
  final Counterpart counterpart;

  /// **Customer only, from ACCEPTED.** The technician cannot read it from the
  /// API at all — it reaches them only by the customer saying it out loud.
  final String? startOtp;

  /// **Customer only, and only while status is IN_PROGRESS.** Revealing it
  /// earlier would let it be handed over before any work was done — which is
  /// exactly what the handshake exists to prevent. Never cache this.
  final String? endOtp;

  final List<BookingEvent> events;
  final DateTime createdAt;

  bool get hasPendingQuote => pendingQuotation != null;

  /// The one short id a person can read out on a phone call.
  ///
  /// Ids are UUIDs, so the first eight characters identify a booking well
  /// enough to quote down a phone line. Guarded anyway: this renders in the
  /// job screen's app bar, and a shorter id would take the whole screen down
  /// rather than merely printing something odd.
  String get shortRef => id.length < 8
      ? '#${id.toUpperCase()}'
      : '#${id.substring(0, 8).toUpperCase()}';

  factory Booking.fromJson(Map<String, dynamic> json) {
    final quotes = (json['quotations'] as List?)
            ?.map((q) => Quotation.fromJson((q as Map).cast<String, dynamic>()))
            .toList() ??
        const <Quotation>[];

    return Booking(
      id: json['id'] as String? ?? '',
      status: BookingStatus.parse(json['status'] as String?),
      categoryId: (json['categoryId'] as num?)?.toInt() ?? 0,
      startsAt: asDate(json['startsAt']),
      endsAt: asDate(json['endsAt']),
      problemNote: json['problemNote'] as String?,
      visitFeePaise: asPaise(json['visitFeePaise'] ?? 0),
      agreedLabour: AgreedLabour.fromJson(
        (json['agreedLabour'] as Map?)?.cast<String, dynamic>(),
      ),
      quotations: quotes,
      pendingQuotation: json['pendingQuotation'] == null
          ? null
          : Quotation.fromJson(
              (json['pendingQuotation'] as Map).cast<String, dynamic>()),
      approvedQuotation: json['approvedQuotation'] == null
          ? null
          : Quotation.fromJson(
              (json['approvedQuotation'] as Map).cast<String, dynamic>()),
      payablePaise: asPaiseOrNull(json['payablePaise']),
      payable:
          Payable.fromJson((json['payable'] as Map?)?.cast<String, dynamic>()),
      settlement: Settlement.fromJson(
        (json['settlement'] as Map?)?.cast<String, dynamic>(),
      ),
      address: BookingAddress.fromJson(json['address']),
      counterpart: Counterpart.fromJson(
          (json['counterpart'] as Map?)?.cast<String, dynamic>()),
      startOtp: json['startOtp'] as String?,
      endOtp: json['endOtp'] as String?,
      events: (json['events'] as List?)
              ?.map((e) =>
                  BookingEvent.fromJson((e as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
              DateTime.now(),
    );
  }
}

/// One line of the final bill.
class PayableComponent {
  const PayableComponent({
    required this.kind,
    required this.labelKey,
    required this.amountPaise,
    required this.waived,
  });

  /// `quotation`, `price_card` or `visit_fee`.
  final String kind;

  /// **An i18n key, never display text.** The client resolves it.
  final String labelKey;

  final int amountPaise;

  /// A waived visit fee is listed at zero rather than omitted, deliberately,
  /// so the customer can see it was not charged.
  final bool waived;

  factory PayableComponent.fromJson(Map<String, dynamic> json) =>
      PayableComponent(
        kind: json['kind'] as String? ?? '',
        labelKey: json['labelKey'] as String? ?? '',
        amountPaise: asPaise(json['amountPaise'] ?? 0),
        waived: json['waived'] as bool? ?? false,
      );
}

/// The settled bill, frozen at the terminal transition.
class Payable {
  const Payable({
    required this.payablePaise,
    required this.payableDisplay,
    required this.visitFeeCharged,
    required this.components,
    required this.basis,
  });

  final int payablePaise;
  final String payableDisplay;
  final bool visitFeeCharged;
  final List<PayableComponent> components;

  /// `approved_quotation`, `price_card` or `visit_fee_only`. Worth surfacing
  /// in the UI — "you were charged the visit fee because the work was
  /// declined" is a different sentence from "this is the agreed price".
  final String basis;

  static Payable? fromJson(Map<String, dynamic>? json) {
    if (json == null) return null;
    return Payable(
      payablePaise: asPaise(json['payablePaise'] ?? 0),
      payableDisplay: json['payableDisplay'] as String? ?? '',
      visitFeeCharged: json['visitFeeCharged'] as bool? ?? false,
      components: (json['components'] as List?)
              ?.map((c) =>
                  PayableComponent.fromJson((c as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      basis: json['basis'] as String? ?? '',
    );
  }
}
