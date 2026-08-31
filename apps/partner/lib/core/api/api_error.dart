import 'package:dio/dio.dart';

/// One field's validation failure, as the API's `details[]` carries it.
class ApiFieldError {
  const ApiFieldError({
    required this.field,
    required this.message,
    required this.code,
  });

  /// The dotted Zod path, or `(root)` when the whole body was wrong.
  final String field;
  final String message;
  final String code;

  factory ApiFieldError.fromJson(Map<String, dynamic> json) => ApiFieldError(
        field: json['field'] as String? ?? '(root)',
        message: json['message'] as String? ?? '',
        code: json['code'] as String? ?? 'INVALID',
      );
}

/// Every non-2xx response from the API, without exception, is
/// `{ error: { code, message, requestId, details? } }`. This is that envelope.
///
/// `message` arrives already localised in the caller's `Accept-Language`, so a
/// screen should prefer showing it over inventing its own copy. The exceptions
/// are the handful of codes below where the right response is an action rather
/// than a sentence.
class ApiError implements Exception {
  ApiError({
    required this.code,
    required this.message,
    required this.statusCode,
    this.requestId,
    this.fieldErrors = const [],
    this.retryAfterSeconds,
    this.rateLimitScope,
  });

  final String code;
  final String message;
  final int statusCode;

  /// Worth surfacing in a bug report — it ties the failure to a server log.
  final String? requestId;

  final List<ApiFieldError> fieldErrors;

  /// Present on 429. Honour it rather than retrying on a guess.
  final int? retryAfterSeconds;

  /// `cooldown` (a resend asked for too soon), `phone`, or `ip`. Each needs
  /// different copy: the first is "wait a moment", the last is closer to
  /// "something is wrong".
  final String? rateLimitScope;

  // ── Codes worth branching on ───────────────────────────────────────────
  static const tokenMissing = 'AUTH_TOKEN_MISSING';
  static const tokenExpired = 'AUTH_TOKEN_EXPIRED';
  static const tokenInvalid = 'AUTH_TOKEN_INVALID';
  static const sessionRevoked = 'AUTH_SESSION_REVOKED';
  static const refreshInvalid = 'REFRESH_TOKEN_INVALID';
  static const otpInvalid = 'OTP_INVALID';
  static const accountBlocked = 'ACCOUNT_BLOCKED';
  static const forbidden = 'FORBIDDEN';
  static const validation = 'VALIDATION_ERROR';
  static const rateLimited = 'RATE_LIMITED';
  static const network = 'NETWORK_UNREACHABLE';
  static const bookingNotFound = 'BOOKING_NOT_FOUND';
  static const providerNotFound = 'PROVIDER_NOT_FOUND';

  /// The access token simply aged out. Refresh and replay — the user should
  /// never see this.
  bool get isExpiredAccessToken => code == tokenExpired;

  /// The session is genuinely over: bad token, revoked session, or a refresh
  /// token that has already been used. Clear everything and sign in again.
  bool get isTerminalAuthFailure =>
      code == tokenInvalid ||
      code == sessionRevoked ||
      code == refreshInvalid ||
      code == tokenMissing;

  bool get isValidation => code == validation;
  bool get isRateLimited => code == rateLimited;

  /// Nothing reached the server. Distinct from an error the server chose to
  /// return, because the retry advice is different.
  bool get isNetwork => code == network;

  /// The message for a field, if the server rejected one by that name.
  String? fieldMessage(String field) {
    for (final e in fieldErrors) {
      if (e.field == field) return e.message;
    }
    return null;
  }

  /// Builds from whatever Dio surfaced.
  ///
  /// A response that is not the documented envelope still has to produce a
  /// usable error — a proxy returning HTML, or a connection that died
  /// mid-body, must not crash a screen.
  factory ApiError.fromDio(DioException e, {required String fallbackMessage}) {
    final response = e.response;

    if (response != null) {
      final data = response.data;
      if (data is Map && data['error'] is Map) {
        final err = (data['error'] as Map).cast<String, dynamic>();
        final details = err['details'];

        return ApiError(
          code: err['code'] as String? ?? 'INTERNAL_ERROR',
          message: err['message'] as String? ?? fallbackMessage,
          statusCode: response.statusCode ?? 0,
          requestId: err['requestId'] as String?,
          fieldErrors: details is List
              ? details
                  .whereType<Map>()
                  .map((d) => ApiFieldError.fromJson(d.cast<String, dynamic>()))
                  .toList()
              : const [],
          retryAfterSeconds: _retryAfter(response, details),
          rateLimitScope: details is Map ? details['scope'] as String? : null,
        );
      }

      return ApiError(
        code: 'INTERNAL_ERROR',
        message: fallbackMessage,
        statusCode: response.statusCode ?? 0,
      );
    }

    return ApiError(
      code: network,
      message: fallbackMessage,
      statusCode: 0,
    );
  }

  static int? _retryAfter(Response<dynamic> response, dynamic details) {
    if (details is Map && details['retryAfterSeconds'] is num) {
      return (details['retryAfterSeconds'] as num).round();
    }
    final header = response.headers.value('retry-after');
    return header == null ? null : int.tryParse(header);
  }

  @override
  String toString() => 'ApiError($statusCode $code): $message';
}
