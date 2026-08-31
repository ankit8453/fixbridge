import '../../core/api/api_client.dart';
import '../models/booking.dart';
import '../models/payment.dart';
import '../models/quotation.dart';
import '../models/support.dart';

/// Everything that happens to a job: creating it, watching it, agreeing the
/// price, paying, and the two ways of complaining about it afterwards.
class BookingRepository {
  BookingRepository(this._api);

  final ApiClient _api;

  // ── The booking itself ─────────────────────────────────────────────────

  Future<Booking> create({
    required String slotId,
    required int categoryId,
    required String addressId,
    String? priceCardId,
    String? problemNote,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings',
      body: {
        'slotId': slotId,
        'categoryId': categoryId,
        'addressId': addressId,
        if (priceCardId != null) 'priceCardId': priceCardId,
        if (problemNote != null && problemNote.trim().isNotEmpty)
          'problemNote': problemNote.trim(),
      },
    );
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// The customer's bookings. Not paginated — the API returns the lot.
  Future<List<Booking>> list() async {
    final json = await _api.get<Map<String, dynamic>>(
      '/bookings',
      query: {'side': 'customer'},
    );
    return (json['bookings'] as List)
        .map((b) => Booking.fromJson((b as Map).cast<String, dynamic>()))
        .toList();
  }

  /// One booking, in full. This is the call the detail screen polls.
  ///
  /// A booking that is not yours returns 404 rather than 403 — the API
  /// resolves which side you are on before it does anything, so a stranger's
  /// booking id reveals nothing at all.
  Future<Booking> byId(String bookingId) async {
    final json = await _api.get<Map<String, dynamic>>('/bookings/$bookingId');
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// Only legal up to EN_ROUTE. [reason] must come from the customer's own
  /// list — a provider's reason sent by a customer is a 400.
  Future<Booking> cancel(
    String bookingId, {
    required String reason,
    String? note,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/cancel',
      body: {
        'reason': reason,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// "I heard the price and I don't want the work done."
  ///
  /// **Not the same as rejecting a quotation.** A rejection invites a
  /// revision; this ends the job, and the visit fee becomes payable because
  /// the technician genuinely turned up. The UI must confirm before calling it.
  Future<Booking> declineWork(String bookingId, {String? note}) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/decline-work',
      body: {
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  // ── The price ──────────────────────────────────────────────────────────

  Future<QuotationHistory> quotations(String bookingId) async {
    final json =
        await _api.get<Map<String, dynamic>>('/bookings/$bookingId/quotations');
    return QuotationHistory.fromJson(json);
  }

  /// The moment the price becomes binding. Customer only — a technician
  /// cannot approve their own number on the customer's behalf, which is the
  /// single most important actor rule in the whole module.
  Future<Quotation> approveQuotation(String quotationId) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/quotations/$quotationId/approve',
    );
    return Quotation.fromJson(
        (json['quotation'] as Map).cast<String, dynamic>());
  }

  /// "Not at that price." Leaves the booking open for a revision.
  Future<Quotation> rejectQuotation(
    String quotationId, {
    String? reason,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/quotations/$quotationId/reject',
      body: {
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
    );
    return Quotation.fromJson(
        (json['quotation'] as Map).cast<String, dynamic>());
  }

  // ── Money ──────────────────────────────────────────────────────────────

  /// Applies a coupon.
  ///
  /// [paymentMethod] is sent explicitly rather than inferred, because at this
  /// point there is usually no payment row yet — the choice exists only on
  /// the customer's screen. The server re-checks it at capture anyway.
  ///
  /// Refused outright once a payment exists, so the coupon field must
  /// disappear from the UI after checkout has started.
  Future<AppliedCoupon> applyCoupon(
    String bookingId, {
    required String code,
    required String paymentMethod,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/coupon',
      body: {'code': code.trim().toUpperCase(), 'paymentMethod': paymentMethod},
    );
    return AppliedCoupon.fromJson(
        (json['coupon'] as Map).cast<String, dynamic>());
  }

  Future<void> removeCoupon(String bookingId) async {
    await _api.delete<Map<String, dynamic>>('/bookings/$bookingId/coupon');
  }

  /// Opens (or re-opens) a gateway order.
  ///
  /// Calling this twice returns the **same** order, deliberately — two live
  /// orders against one bill is exactly how a customer ends up paying twice.
  /// So a retry here is safe and does not need guarding.
  Future<PaymentOrder> startPayment(String bookingId) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/payments',
      body: const {'purpose': 'final_bill'},
    );
    return PaymentOrder.fromJson(json);
  }

  /// Hands the gateway's signed result back for verification.
  ///
  /// **This does not mean paid.** It verifies the signature and stamps a flag
  /// so the app can honestly say "confirming your payment". No money moves
  /// here; the webhook is the truth. Poll [payments] until captured.
  Future<Payment> confirmCheckout({
    required String paymentId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/payments/$paymentId/checkout-callback',
      body: {
        // Razorpay's own field names, snake_case, exactly as the API expects.
        'razorpay_order_id': razorpayOrderId,
        'razorpay_payment_id': razorpayPaymentId,
        'razorpay_signature': razorpaySignature,
      },
    );
    return Payment.fromJson((json['payment'] as Map).cast<String, dynamic>());
  }

  Future<List<Payment>> payments(String bookingId) async {
    final json =
        await _api.get<Map<String, dynamic>>('/bookings/$bookingId/payments');
    return (json['payments'] as List)
        .map((p) => Payment.fromJson((p as Map).cast<String, dynamic>()))
        .toList();
  }

  // ── Afterwards ─────────────────────────────────────────────────────────

  /// Which direction the review is, and therefore which tags are legal, is
  /// decided server-side from who is calling. The body carries no direction.
  Future<Review> leaveReview(
    String bookingId, {
    required int stars,
    List<String> tags = const [],
    String? text,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/reviews',
      body: {
        'stars': stars,
        if (tags.isNotEmpty) 'tags': tags.take(ReviewTags.maxTags).toList(),
        if (text != null && text.trim().isNotEmpty) 'text': text.trim(),
      },
    );
    return Review.fromJson((json['review'] as Map).cast<String, dynamic>());
  }

  Future<List<Review>> reviews(String bookingId) async {
    final json =
        await _api.get<Map<String, dynamic>>('/bookings/$bookingId/reviews');
    return (json['reviews'] as List)
        .map((r) => Review.fromJson((r as Map).cast<String, dynamic>()))
        .toList();
  }

  /// Available from ARRIVED onwards — once somebody has actually turned up.
  ///
  /// A `safety` complaint suspends the technician **before this call
  /// returns**; it is handled synchronously rather than queued. Worth saying
  /// plainly in the UI, because it changes what the customer expects to happen.
  Future<Complaint> raiseComplaint(
    String bookingId, {
    required String category,
    required String description,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/complaints',
      body: {'category': category, 'description': description.trim()},
    );
    return Complaint.fromJson(
        (json['complaint'] as Map).cast<String, dynamic>());
  }

  /// Complaints this person raised and complaints against them. Not paginated.
  Future<List<Complaint>> complaints() async {
    final json = await _api.get<Map<String, dynamic>>('/complaints');
    return (json['complaints'] as List)
        .map((c) => Complaint.fromJson((c as Map).cast<String, dynamic>()))
        .toList();
  }
}
