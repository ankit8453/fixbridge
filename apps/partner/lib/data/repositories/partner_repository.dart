import 'dart:io';

import 'package:dio/dio.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../models/booking.dart';
import '../models/partner_profile.dart';
import '../models/payment.dart';

import '../models/profile_photo.dart';
import '../models/quotation.dart';
import '../models/trust.dart';
import '../models/payout_detail.dart';
import '../models/wallet.dart';

/// Everything a technician does.
class PartnerRepository {
  PartnerRepository(this._api);

  final ApiClient _api;

  // ── Becoming a technician ──────────────────────────────────────────────

  /// Grants the `technician` role and opens an empty profile.
  ///
  /// **The session must be refreshed afterwards.** The role is baked into the
  /// access token's claims, so a token minted before this call does not carry
  /// it and every technician route answers 403.
  Future<void> register({String? displayName, int? cityId}) async {
    await _api.post<Map<String, dynamic>>(
      '/providers/me/register',
      body: {
        if (displayName != null) 'displayName': displayName.trim(),
        if (cityId != null) 'cityId': cityId,
      },
    );
  }

  // ── Profile ────────────────────────────────────────────────────────────

  Future<PartnerProfile> profile() async {
    final json = await _api.get<Map<String, dynamic>>('/providers/me');
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  /// `bio` and `yearsExperience` accept null to clear, so they are sent
  /// whenever explicitly provided rather than only when non-null.
  Future<PartnerProfile> updateProfile({
    String? displayName,
    String? bio,
    bool clearBio = false,
    int? yearsExperience,
    bool clearExperience = false,
    int? cityId,
    int? serviceRadiusKm,
    double? lat,
    double? lng,
  }) async {
    final hasLocation = lat != null && lng != null;

    final json = await _api.patch<Map<String, dynamic>>(
      '/providers/me',
      body: {
        if (displayName != null) 'displayName': displayName.trim(),
        if (clearBio) 'bio': null else if (bio != null) 'bio': bio.trim(),
        if (clearExperience)
          'yearsExperience': null
        else if (yearsExperience != null)
          'yearsExperience': yearsExperience,
        if (cityId != null) 'cityId': cityId,
        if (serviceRadiusKm != null) 'serviceRadiusKm': serviceRadiusKm,
        if (hasLocation) 'baseLocation': {'lat': lat, 'lng': lng},
      },
    );
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  Future<PartnerProfile> addSkill(int categoryId, {String? note}) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/providers/me/skills',
      body: {
        'categoryId': categoryId,
        if (note != null && note.trim().isNotEmpty)
          'experienceNote': note.trim(),
      },
    );
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  Future<PartnerProfile> removeSkill(int categoryId) async {
    final json = await _api.delete<Map<String, dynamic>>(
      '/providers/me/skills/$categoryId',
    );
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  /// A price. Only `fixed` can be set — the two older types survive on
  /// historical rows but nothing writes them any more.
  Future<PartnerProfile> addPriceCard({
    required int categoryId,
    required String title,
    required int amountPaise,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/providers/me/price-cards',
      body: {
        'categoryId': categoryId,
        'title': title.trim(),
        'priceType': 'fixed',
        'amountPaise': amountPaise,
      },
    );
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  Future<PartnerProfile> updatePriceCard(
    String id, {
    String? title,
    int? amountPaise,
    bool? isActive,
  }) async {
    final json = await _api.patch<Map<String, dynamic>>(
      '/providers/me/price-cards/$id',
      body: {
        if (title != null) 'title': title.trim(),
        if (amountPaise != null) 'amountPaise': amountPaise,
        if (isActive != null) 'isActive': isActive,
      },
    );
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  Future<PartnerProfile> removePriceCard(String id) async {
    final json = await _api
        .delete<Map<String, dynamic>>('/providers/me/price-cards/$id');
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  /// A weekly window. Times are `HH:MM` strings in both directions.
  /// Saving one materialises bookable slots immediately.
  Future<PartnerProfile> addAvailability({
    required int dayOfWeek,
    required String startTime,
    required String endTime,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/providers/me/availability',
      body: {
        'dayOfWeek': dayOfWeek,
        'startTime': startTime,
        'endTime': endTime,
      },
    );
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  Future<PartnerProfile> removeAvailability(String id) async {
    final json = await _api
        .delete<Map<String, dynamic>>('/providers/me/availability/$id');
    return PartnerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  // ── Work ───────────────────────────────────────────────────────────────

  /// The technician's own bookings.
  ///
  /// **`side=provider` is not optional.** Omitting it returns the *customer*
  /// list — empty, with no error — which is the kind of bug that looks like
  /// "no jobs today" rather than like a mistake.
  Future<List<Booking>> bookings() async {
    final json = await _api.get<Map<String, dynamic>>(
      '/bookings',
      query: {'side': 'provider'},
    );
    final list = (json['bookings'] as List)
        .map((b) => Booking.fromJson((b as Map).cast<String, dynamic>()))
        .toList();
    list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  Future<Booking> booking(String bookingId) async {
    final json = await _api.get<Map<String, dynamic>>('/bookings/$bookingId');
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// Takes the job. The customer's address and phone become visible, and the
  /// handshake codes are minted on their phone at this moment.
  Future<Booking> accept(String bookingId) async {
    final json =
        await _api.post<Map<String, dynamic>>('/bookings/$bookingId/accept');
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// [note] is required when [reason] is `other`.
  Future<Booking> reject(
    String bookingId, {
    required String reason,
    String? note,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/reject',
      body: {
        'reason': reason,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  Future<Booking> enRoute(String bookingId) async {
    final json =
        await _api.post<Map<String, dynamic>>('/bookings/$bookingId/en-route');
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// The start handshake. Records `arrived` and `work_started` together, so
  /// the history shows that arrival was proven rather than merely claimed.
  ///
  /// A wrong code returns 401 with the attempts remaining in `details`. Five
  /// failures lock the booking for seven days and only ops can unlock it.
  Future<Booking> start(String bookingId, String otp) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/start',
      body: {'otp': otp},
    );
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// The end handshake.
  ///
  /// The price is checked **before** the code, deliberately — so a technician
  /// with an unapproved quotation is told that, rather than watching a correct
  /// code get rejected for an unrelated reason. Two 409s to expect:
  /// `QUOTATION_PENDING` and `QUOTATION_REQUIRED`.
  Future<Booking> complete(String bookingId, String otp) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/complete',
      body: {'otp': otp},
    );
    return Booking.fromJson((json['booking'] as Map).cast<String, dynamic>());
  }

  /// Only legal up to EN_ROUTE, and it counts against the reliability
  /// component of the trust score.
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

  // ── The price ──────────────────────────────────────────────────────────

  /// Sends a price. Always a new version, never an edit.
  ///
  /// The split is sent explicitly: the server can derive it, but being
  /// explicit is what makes the agreed figure and the extra separable on the
  /// customer's screen. Extra labour without a reason is refused.
  Future<Quotation> sendQuotation(
    String bookingId, {
    required int labourPaise,
    int? agreedLabourPaise,
    int? extraLabourPaise,
    String? extraLabourReason,
    List<Map<String, Object>> items = const [],
    String? note,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/quotations',
      body: {
        'labourPaise': labourPaise,
        if (agreedLabourPaise != null) 'agreedLabourPaise': agreedLabourPaise,
        if (extraLabourPaise != null && extraLabourPaise > 0)
          'extraLabourPaise': extraLabourPaise,
        if (extraLabourReason != null && extraLabourReason.trim().isNotEmpty)
          'extraLabourReason': extraLabourReason.trim(),
        'items': items,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
    return Quotation.fromJson(
        (json['quotation'] as Map).cast<String, dynamic>());
  }

  /// The technician's own correction, only while the customer has not decided.
  Future<Quotation> withdrawQuotation(String quotationId) async {
    final json = await _api
        .post<Map<String, dynamic>>('/quotations/$quotationId/withdraw');
    return Quotation.fromJson(
        (json['quotation'] as Map).cast<String, dynamic>());
  }

  Future<QuotationHistory> quotations(String bookingId) async {
    final json =
        await _api.get<Map<String, dynamic>>('/bookings/$bookingId/quotations');
    return QuotationHistory.fromJson(json);
  }

  // ── Money ──────────────────────────────────────────────────────────────

  /// Records that cash was taken.
  ///
  /// Note what this does to the books: only the commission passes through us,
  /// because the gross went hand to hand. So recording cash **increases** what
  /// the technician owes — the UI has to say that or it reads as a bug.
  ///
  /// Any coupon on the booking is dropped server-side, and the full
  /// pre-discount amount is collected: the discount comes out of commission,
  /// which only works when the money actually passes through us.
  Future<Payment> recordCash(String bookingId, {String? note}) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/bookings/$bookingId/payments/cash',
      body: {
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
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

  Future<Wallet> wallet() async {
    final json = await _api.get<Map<String, dynamic>>('/providers/me/wallet');
    return Wallet.fromJson((json['wallet'] as Map).cast<String, dynamic>());
  }

  /// Where the next payout goes, or null if nobody has said yet.
  ///
  /// Null is a normal answer, not a failure — the form is asked for before the
  /// first payout rather than at signup, so a technician who has not earned
  /// anything yet has legitimately never seen it.
  Future<PayoutDetail?> payoutDetail() async {
    final json =
        await _api.get<Map<String, dynamic>>('/providers/me/payout-details');
    return PayoutDetail.fromJson(
      (json['payoutDetail'] as Map?)?.cast<String, dynamic>(),
    );
  }

  /// Replaces the payout details outright.
  ///
  /// A full replace, matching the API: switching from bank to UPI must not
  /// leave the old account number behind in fields nobody reads any more.
  /// [confirmAccountNumber] is sent rather than only checked on the phone,
  /// because a wrong-but-valid account number pays a stranger and there is no
  /// undo — the server compares them too.
  Future<PayoutDetail> savePayoutDetail({
    required String method,
    String? accountNumber,
    String? confirmAccountNumber,
    String? ifsc,
    String? accountHolder,
    String? upiId,
    String? pan,
  }) async {
    final json = await _api.put<Map<String, dynamic>>(
      '/providers/me/payout-details',
      body: {
        'method': method,
        if (method == 'bank') ...{
          'accountNumber': accountNumber,
          'confirmAccountNumber': confirmAccountNumber,
          'ifsc': ifsc,
          'accountHolder': accountHolder,
        },
        if (method == 'upi') 'upiId': upiId,
        // Omitted entirely when blank. Sending an empty string would fail the
        // format check on a field the technician deliberately left alone.
        if (pan != null && pan.isNotEmpty) 'pan': pan,
      },
    );

    return PayoutDetail.fromJson(
      (json['payoutDetail'] as Map).cast<String, dynamic>(),
    )!;
  }

  // ── Standing ───────────────────────────────────────────────────────────

  Future<Trust> trust() async {
    final json = await _api.get<Map<String, dynamic>>('/providers/me/trust');
    return Trust.fromJson((json['trust'] as Map).cast<String, dynamic>());
  }

  // ── Slots ──────────────────────────────────────────────────────────────

  /// Own slots, including booked and blocked ones. Both bounds are required —
  /// there is no "next week" default.
  Future<List<OwnSlot>> slots({
    required DateTime from,
    required DateTime to,
  }) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/providers/me/slots',
      query: {
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
      },
    );
    return (json['slots'] as List)
        .map((s) => OwnSlot.fromJson((s as Map).cast<String, dynamic>()))
        .toList();
  }

  Future<void> blockSlot(String slotId) async {
    await _api.post<Map<String, dynamic>>('/providers/me/slots/$slotId/block');
  }

  Future<void> unblockSlot(String slotId) async {
    await _api
        .post<Map<String, dynamic>>('/providers/me/slots/$slotId/unblock');
  }

  // ── Profile photo ──────────────────────────────────────────────────────

  /// The picture a customer sees once they have accepted.
  ///
  /// Deliberately separate from the verification `photo` document, which is a
  /// KYC portrait that ops review and no customer ever sees. Uploading one
  /// does not satisfy the other; they answer different questions.
  Future<ProfilePhoto?> photo() async {
    final json = await _api.get<Map<String, dynamic>>('/providers/me/photo');
    return ProfilePhoto.fromJson(
        (json['photo'] as Map?)?.cast<String, dynamic>());
  }

  /// The three-step upload: ask, PUT, confirm.
  ///
  /// [sizeBytes] and [contentType] are signed into the URL, so they are
  /// declared up front and cannot be a guess — storage rejects a body that
  /// does not match what was signed.
  Future<ProfilePhoto> uploadPhoto(File file,
      {required String contentType}) async {
    final bytes = await file.readAsBytes();

    final issued = await _api.post<Map<String, dynamic>>(
      '/providers/me/photo/upload-url',
      body: {'contentType': contentType, 'sizeBytes': bytes.length},
    );

    final photoId = issued['photoId'] as String? ?? '';
    final upload = (issued['upload'] as Map?)?.cast<String, dynamic>();
    final url = upload?['url'] as String? ?? '';
    final headers = (upload?['requiredHeaders'] as Map?)?.map(
          (k, v) => MapEntry(k.toString(), v.toString()),
        ) ??
        const <String, String>{};

    // A bare Dio on purpose: this goes to storage, not to our API, so it must
    // not carry our Authorization header, and the signed headers have to
    // arrive exactly as they were issued.
    try {
      await Dio().put<void>(
        url,
        data: Stream.fromIterable([bytes]),
        options: Options(
          headers: {...headers, Headers.contentLengthHeader: bytes.length},
        ),
      );
    } on DioException catch (e) {
      throw ApiError.fromDio(
        e,
        fallbackMessage: 'Could not upload that photo. Try again.',
      );
    }

    // Until this runs the object exists in storage but the profile does not
    // know about it, so nothing would ever show it.
    final confirmed = await _api.post<Map<String, dynamic>>(
      '/providers/me/photo/$photoId/confirm',
    );
    final photo = ProfilePhoto.fromJson(
        (confirmed['photo'] as Map?)?.cast<String, dynamic>());
    if (photo == null) {
      throw ApiError(
        code: 'PHOTO_NOT_SAVED',
        message: 'The photo uploaded but did not save. Try again.',
        statusCode: 500,
      );
    }
    return photo;
  }
}
