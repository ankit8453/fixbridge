import '../../core/api/api_client.dart';
import '../models/address.dart';
import '../models/notification.dart';

/// The customer's own profile, their addresses, and the notification inbox.
class AccountRepository {
  AccountRepository(this._api);

  final ApiClient _api;

  // ── Profile ────────────────────────────────────────────────────────────

  Future<CustomerProfile> profile() async {
    final json = await _api.get<Map<String, dynamic>>('/customers/me');
    return CustomerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  /// Passing `null` for [email] clears it; omitting it leaves it untouched.
  /// The distinction is real in the API, so it is preserved here rather than
  /// flattened into one nullable argument.
  Future<CustomerProfile> updateProfile({
    String? displayName,
    String? email,
    bool clearEmail = false,
  }) async {
    final json = await _api.patch<Map<String, dynamic>>(
      '/customers/me',
      body: {
        if (displayName != null) 'displayName': displayName.trim(),
        if (clearEmail) 'email': null else if (email != null) 'email': email.trim(),
      },
    );
    return CustomerProfile.fromJson(
        (json['profile'] as Map).cast<String, dynamic>());
  }

  // ── Addresses ──────────────────────────────────────────────────────────

  Future<List<Address>> addresses() async {
    final json = await _api.get<Map<String, dynamic>>('/customers/me/addresses');
    return (json['addresses'] as List)
        .map((a) => Address.fromJson((a as Map).cast<String, dynamic>()))
        .toList();
  }

  /// Coordinates are optional — a phone with GPS sends them, everyone else is
  /// geocoded from the text. They must travel **together**: a lone `lat` is a
  /// validation error, so both are sent or neither is.
  Future<Address> addAddress({
    required String addressText,
    String label = 'other',
    String? labelText,
    String? landmark,
    int? cityId,
    double? lat,
    double? lng,
    bool isDefault = false,
  }) async {
    final hasCoords = lat != null && lng != null;

    final json = await _api.post<Map<String, dynamic>>(
      '/customers/me/addresses',
      body: {
        'addressText': addressText.trim(),
        'label': label,
        if (labelText != null && labelText.trim().isNotEmpty)
          'labelText': labelText.trim(),
        if (landmark != null && landmark.trim().isNotEmpty)
          'landmark': landmark.trim(),
        if (cityId != null) 'cityId': cityId,
        if (hasCoords) 'lat': lat,
        if (hasCoords) 'lng': lng,
        if (isDefault) 'isDefault': true,
      },
    );
    return Address.fromJson((json['address'] as Map).cast<String, dynamic>());
  }

  Future<Address> updateAddress(
    String addressId, {
    String? addressText,
    String? label,
    String? landmark,
    double? lat,
    double? lng,
  }) async {
    final hasCoords = lat != null && lng != null;

    final json = await _api.patch<Map<String, dynamic>>(
      '/customers/me/addresses/$addressId',
      body: {
        if (addressText != null) 'addressText': addressText.trim(),
        if (label != null) 'label': label,
        if (landmark != null) 'landmark': landmark.trim(),
        if (hasCoords) 'lat': lat,
        if (hasCoords) 'lng': lng,
      },
    );
    return Address.fromJson((json['address'] as Map).cast<String, dynamic>());
  }

  Future<void> deleteAddress(String addressId) async {
    await _api.delete<Map<String, dynamic>>(
      '/customers/me/addresses/$addressId',
    );
  }

  Future<Address> setDefaultAddress(String addressId) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/customers/me/addresses/$addressId/default',
    );
    return Address.fromJson((json['address'] as Map).cast<String, dynamic>());
  }

  // ── Inbox ──────────────────────────────────────────────────────────────

  Future<NotificationPage> notifications({
    int page = 1,
    int pageSize = 20,
    bool unreadOnly = false,
  }) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/notifications',
      query: {
        'page': page,
        'page_size': pageSize,
        // The API expects the literal strings, not a boolean.
        'unread_only': unreadOnly ? 'true' : 'false',
      },
    );
    return NotificationPage.fromJson(json);
  }

  /// The bell badge. Cheap enough to poll on a slow cadence.
  Future<int> unreadCount() async {
    final json =
        await _api.get<Map<String, dynamic>>('/notifications/unread-count');
    return (json['unread'] as num?)?.toInt() ?? 0;
  }

  /// Idempotent, and deliberately indistinguishable across "already read",
  /// "belongs to someone else" and "does not exist" — otherwise the endpoint
  /// would let anyone enumerate real notification ids.
  Future<int> markRead(String notificationId) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/notifications/$notificationId/read',
    );
    return (json['unread'] as num?)?.toInt() ?? 0;
  }

  Future<void> markAllRead() async {
    await _api.post<Map<String, dynamic>>('/notifications/read-all');
  }
}
