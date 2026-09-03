import 'dart:async';

import 'package:dio/dio.dart';

import '../config/env.dart';
import '../storage/session_store.dart';
import 'api_error.dart';

/// The session an authenticated call needs. Held in memory only — the access
/// token is short-lived (15 minutes by default) and there is nothing gained by
/// writing it to disk.
class AuthTokens {
  const AuthTokens({required this.accessToken, required this.expiresAt});

  final String accessToken;
  final DateTime expiresAt;

  /// Treated as expired a little early, so a request does not leave with a
  /// token that dies in flight.
  bool get isNearlyExpired =>
      DateTime.now().isAfter(expiresAt.subtract(const Duration(seconds: 30)));
}

/// The single HTTP entry point.
///
/// Two things here are worth more care than the rest of the app put together.
///
/// **Refreshes are serialised.** The API rotates refresh tokens on every use
/// and treats a second presentation of an already-rotated token as theft: it
/// revokes *every* token for that device. So two screens hitting a 401 at the
/// same moment and each firing its own refresh is not a slow path — it is a
/// silent logout. [_refreshInFlight] makes the second caller await the first
/// one's result instead of starting its own.
///
/// **Only GETs are retried.** `POST /bookings` and `POST /bookings/:id/payments`
/// are not idempotent from the client's side; a retry that succeeds after a
/// timeout the client already gave up on is a double booking or a double
/// charge. A GET that fails costs a spinner.
class ApiClient {
  ApiClient({
    required SessionStore store,
    required this.onSessionLost,
    required this.currentLocale,
  }) : _store = store {
    _dio = Dio(
      BaseOptions(
        baseUrl: Env.apiBaseUrl,
        connectTimeout: Env.connectTimeout,
        receiveTimeout: Env.receiveTimeout,
        sendTimeout: Env.connectTimeout,
        // Non-2xx is handled by our own interceptor, not thrown by status.
        validateStatus: (code) => code != null && code < 400,
        headers: {'Content-Type': 'application/json'},
      ),
    );

    // A bare client for refresh and sign-in. It must NOT carry the auth
    // interceptor, or a failing refresh would trigger a refresh.
    _bare = Dio(
      BaseOptions(
        baseUrl: Env.apiBaseUrl,
        connectTimeout: Env.connectTimeout,
        receiveTimeout: Env.receiveTimeout,
        validateStatus: (code) => code != null && code < 400,
        headers: {'Content-Type': 'application/json'},
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: _onRequest,
        onError: _onError,
      ),
    );
  }

  final SessionStore _store;

  /// Called when the session is gone for good and the user must sign in
  /// again. The app routes to the sign-in screen on this.
  final void Function() onSessionLost;

  /// Read at request time rather than captured, so changing the language
  /// takes effect on the very next call.
  final String Function() currentLocale;

  late final Dio _dio;
  late final Dio _bare;

  AuthTokens? _tokens;
  Future<AuthTokens?>? _refreshInFlight;

  bool get isAuthenticated => _tokens != null;

  void setTokens(AuthTokens? tokens) => _tokens = tokens;

  void clearTokens() {
    _tokens = null;
    _refreshInFlight = null;
  }

  // ── Interceptors ───────────────────────────────────────────────────────

  Future<void> _onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    options.headers['Accept-Language'] = currentLocale();

    if (options.extra['skipAuth'] != true) {
      // Refresh proactively when the token is about to die, so the common
      // case never spends a round trip on a 401.
      if (_tokens != null && _tokens!.isNearlyExpired) {
        await _refresh();
      }
      final token = _tokens?.accessToken;
      if (token != null) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }

    handler.next(options);
  }

  Future<void> _onError(
    DioException e,
    ErrorInterceptorHandler handler,
  ) async {
    final status = e.response?.statusCode;
    final code = _codeOf(e);

    // The access token aged out. Refresh once, replay once. If the replay
    // itself 401s, fall through — something else is wrong.
    if (status == 401 &&
        code == ApiError.tokenExpired &&
        e.requestOptions.extra['retried'] != true &&
        e.requestOptions.extra['skipAuth'] != true) {
      final refreshed = await _refresh();
      if (refreshed != null) {
        try {
          final opts = e.requestOptions;
          opts.extra['retried'] = true;
          opts.headers['Authorization'] = 'Bearer ${refreshed.accessToken}';
          final response = await _dio.fetch<dynamic>(opts);
          return handler.resolve(response);
        } on DioException catch (retryError) {
          return handler.next(retryError);
        }
      }
    }

    // Nothing to salvage: the session is over.
    if (status == 401 &&
        (code == ApiError.tokenInvalid ||
            code == ApiError.sessionRevoked ||
            code == ApiError.refreshInvalid)) {
      await _endSession();
    }

    handler.next(e);
  }

  String? _codeOf(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['error'] is Map) {
      return (data['error'] as Map)['code'] as String?;
    }
    return null;
  }

  // ── Refresh ────────────────────────────────────────────────────────────

  /// Serialised. Concurrent callers share one in-flight refresh; see the
  /// class comment for why that is not merely an optimisation.
  Future<AuthTokens?> _refresh() {
    return _refreshInFlight ??= _doRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<AuthTokens?> _doRefresh() async {
    final refreshToken = await _store.readRefreshToken();
    if (refreshToken == null) {
      await _endSession();
      return null;
    }

    try {
      final deviceId = await _store.deviceId();
      final response = await _bare.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken, 'deviceId': deviceId},
      );

      final body = response.data!;
      final tokens = AuthTokens(
        accessToken: body['accessToken'] as String,
        expiresAt: DateTime.now()
            .add(Duration(seconds: (body['expiresIn'] as num).toInt())),
      );

      // The old token is now revoked server-side. Storing the new one is not
      // optional — losing it here signs the user out on the next launch.
      await _store.writeRefreshToken(body['refreshToken'] as String);
      _tokens = tokens;
      return tokens;
    } on DioException catch (e) {
      // A network failure is not a dead session. Only an answer from the
      // server saying the token is no good ends things.
      if (e.response != null) {
        await _endSession();
      }
      return null;
    }
  }

  Future<void> _endSession() async {
    clearTokens();
    await _store.clearSession();
    onSessionLost();
  }

  // ── Verbs ──────────────────────────────────────────────────────────────

  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? query,
    bool auth = true,
  }) {
    return _send<T>(
      () => _dio.get<T>(
        path,
        queryParameters: _clean(query),
        options: Options(extra: {'skipAuth': !auth}),
      ),
      // Safe: a GET has no side effect the server would have to undo.
      retries: 2,
    );
  }

  Future<T> post<T>(
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    bool auth = true,
  }) {
    return _send<T>(
      () => _dio.post<T>(
        path,
        data: body,
        queryParameters: _clean(query),
        options: Options(extra: {'skipAuth': !auth}),
      ),
    );
  }

  /// A full replace. Used where a partial update would leave stale fields
  /// behind — payout details, where switching bank to UPI must not keep the
  /// old account number.
  Future<T> put<T>(String path, {Object? body, bool auth = true}) {
    return _send<T>(
      () => _dio.put<T>(
        path,
        data: body,
        options: Options(extra: {'skipAuth': !auth}),
      ),
    );
  }

  Future<T> patch<T>(String path, {Object? body, bool auth = true}) {
    return _send<T>(
      () => _dio.patch<T>(
        path,
        data: body,
        options: Options(extra: {'skipAuth': !auth}),
      ),
    );
  }

  Future<T> delete<T>(String path, {Object? body, bool auth = true}) {
    return _send<T>(
      () => _dio.delete<T>(
        path,
        data: body,
        options: Options(extra: {'skipAuth': !auth}),
      ),
    );
  }

  /// Runs a call, converts any failure into an [ApiError], and retries only
  /// when the caller said it was safe.
  Future<T> _send<T>(
    Future<Response<T>> Function() call, {
    int retries = 0,
  }) async {
    var attempt = 0;

    while (true) {
      try {
        final response = await call();
        return response.data as T;
      } on DioException catch (e) {
        final isTransport = e.response == null &&
            e.type != DioExceptionType.cancel &&
            e.type != DioExceptionType.badResponse;

        if (isTransport && attempt < retries) {
          attempt += 1;
          // 1s then 3s. Long enough for a cell to reattach, short enough
          // that a person has not yet decided the app is broken.
          await Future<void>.delayed(Duration(seconds: attempt == 1 ? 1 : 3));
          continue;
        }

        throw ApiError.fromDio(
          e,
          fallbackMessage: isTransport
              ? 'Could not reach the internet. Check your connection.'
              : 'Something went wrong. Please try again.',
        );
      }
    }
  }

  /// Drops null query values so `?city_id=null` never reaches a `.strict()`
  /// schema, which would reject the whole request.
  Map<String, dynamic>? _clean(Map<String, dynamic>? query) {
    if (query == null) return null;
    final out = <String, dynamic>{};
    query.forEach((key, value) {
      if (value != null) out[key] = value;
    });
    return out.isEmpty ? null : out;
  }

  /// Used by the sign-in flow, which has no access token yet and must not
  /// have the interceptor attach one.
  Future<Map<String, dynamic>> postPublic(
    String path, {
    Object? body,
  }) async {
    try {
      final response = await _bare.post<Map<String, dynamic>>(
        path,
        data: body,
        options: Options(
          headers: {'Accept-Language': currentLocale()},
        ),
      );
      return response.data ?? const {};
    } on DioException catch (e) {
      throw ApiError.fromDio(
        e,
        fallbackMessage: e.response == null
            ? 'Could not reach the internet. Check your connection.'
            : 'Something went wrong. Please try again.',
      );
    }
  }
}
