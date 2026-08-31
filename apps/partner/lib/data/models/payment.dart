import 'money.dart';

/// A payment row.
///
/// The status here is the only honest answer to "has this been paid?".
/// A successful checkout does **not** mean captured: the callback sets
/// [checkoutVerifiedAt] and nothing more, and money moves only when the
/// gateway's webhook arrives. So the app polls this until [isCaptured].
class Payment {
  const Payment({
    required this.id,
    required this.bookingId,
    required this.purpose,
    required this.method,
    required this.amountPaise,
    required this.amountDisplay,
    required this.status,
    required this.commissionBps,
    required this.gatewayOrderId,
    required this.checkoutVerifiedAt,
    required this.capturedAt,
    required this.createdAt,
  });

  final String id;
  final String? bookingId;

  /// `final_bill` or `visit_fee_upfront`.
  final String purpose;

  /// `online` or `cash`.
  final String method;

  final int amountPaise;
  final String amountDisplay;

  /// `created`, `captured`, `failed`, `refunded`, `partially_refunded`.
  final String status;

  final int commissionBps;
  final String? gatewayOrderId;

  /// The app said checkout succeeded and the signature checked out. Nothing
  /// has moved on the strength of it.
  final DateTime? checkoutVerifiedAt;

  final DateTime? capturedAt;
  final DateTime createdAt;

  /// The only state that means the money is actually ours.
  bool get isCaptured => status == 'captured';

  bool get isFailed => status == 'failed';
  bool get isCash => method == 'cash';

  /// Checkout came back fine but the webhook has not landed yet. The copy for
  /// this state is "we're confirming your payment" — never "failed", because
  /// a late webhook is ordinary and the payment is very probably fine.
  bool get isAwaitingConfirmation =>
      status == 'created' && checkoutVerifiedAt != null;

  String get display => Paise.show(amountDisplay, amountPaise);

  factory Payment.fromJson(Map<String, dynamic> json) => Payment(
        id: json['id'] as String,
        bookingId: json['bookingId'] as String?,
        purpose: json['purpose'] as String? ?? 'final_bill',
        method: json['method'] as String? ?? 'online',
        amountPaise: asPaise(json['amountPaise'] ?? 0),
        amountDisplay: json['amountDisplay'] as String? ?? '',
        status: json['status'] as String? ?? 'created',
        commissionBps: (json['commissionBps'] as num?)?.toInt() ?? 0,
        gatewayOrderId: json['gatewayOrderId'] as String?,
        checkoutVerifiedAt:
            DateTime.tryParse(json['checkoutVerifiedAt'] as String? ?? '')
                ?.toLocal(),
        capturedAt:
            DateTime.tryParse(json['capturedAt'] as String? ?? '')?.toLocal(),
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
      );
}

/// What starting a payment returns — everything the checkout sheet needs and
/// nothing secret. [keyId] is the publishable key; the secret never leaves
/// the server.
class PaymentOrder {
  const PaymentOrder({
    required this.payment,
    required this.orderId,
    required this.amountPaise,
    required this.currency,
    required this.keyId,
    required this.reused,
  });

  final Payment payment;
  final String orderId;
  final int amountPaise;
  final String currency;
  final String keyId;

  /// True when an existing order came back rather than a new one. Starting a
  /// payment twice deliberately returns the *same* order — two live orders
  /// for one bill is how a customer pays twice.
  final bool reused;

  factory PaymentOrder.fromJson(Map<String, dynamic> json) => PaymentOrder(
        payment:
            Payment.fromJson((json['payment'] as Map).cast<String, dynamic>()),
        orderId: json['orderId'] as String,
        amountPaise: asPaise(json['amountPaise'] ?? 0),
        currency: json['currency'] as String? ?? 'INR',
        keyId: json['keyId'] as String,
        reused: json['reused'] as bool? ?? false,
      );
}

/// A coupon applied to a booking, with both the before and after so the
/// saving can be shown rather than asserted.
class AppliedCoupon {
  const AppliedCoupon({
    required this.code,
    required this.discountPaise,
    required this.discountDisplay,
    required this.originalPayablePaise,
    required this.originalPayableDisplay,
    required this.payablePaise,
    required this.payableDisplay,
  });

  final String code;
  final int discountPaise;
  final String discountDisplay;

  /// The bill before the coupon — and what the technician is paid on. The
  /// discount is funded by the platform, not by them.
  final int originalPayablePaise;
  final String originalPayableDisplay;

  final int payablePaise;
  final String payableDisplay;

  factory AppliedCoupon.fromJson(Map<String, dynamic> json) => AppliedCoupon(
        code: json['code'] as String? ?? '',
        discountPaise: asPaise(json['discountPaise'] ?? 0),
        discountDisplay: json['discountDisplay'] as String? ?? '',
        originalPayablePaise: asPaise(json['originalPayablePaise'] ?? 0),
        originalPayableDisplay: json['originalPayableDisplay'] as String? ?? '',
        payablePaise: asPaise(json['payablePaise'] ?? 0),
        payableDisplay: json['payableDisplay'] as String? ?? '',
      );
}
