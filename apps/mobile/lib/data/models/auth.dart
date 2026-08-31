/// The signed-in person, as `/auth/me` and the OTP verification return them.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.phone,
    required this.name,
    required this.roles,
    required this.status,
    required this.defaultCityId,
    required this.preferredLanguage,
    required this.createdAt,
  });

  final String id;

  /// **Always masked** — the API returns `+9198765*****` even to the account's
  /// own owner. Nothing in the app should present this as the full number.
  final String phone;

  final String? name;

  /// `customer`, `technician`, `ops`, `admin`. A person can hold more than
  /// one: registering as a technician adds a role rather than replacing it.
  final List<String> roles;

  /// `active` or `blocked`.
  final String status;

  final int? defaultCityId;

  /// `hi` or `en`. The account's own setting, which follows the user to a new
  /// phone — distinct from the device's language choice before sign-in.
  final String preferredLanguage;

  final DateTime createdAt;

  bool get isCustomer => roles.contains('customer');
  bool get isTechnician => roles.contains('technician');
  bool get isBlocked => status != 'active';

  /// First name only, for a greeting. A greeting that uses somebody's full
  /// legal name reads like a bank letter.
  String get greetingName {
    final n = name?.trim();
    if (n == null || n.isEmpty) return '';
    final first = n.split(RegExp(r'\s+')).first;
    return first;
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as String,
        phone: json['phone'] as String? ?? '',
        name: json['name'] as String?,
        roles:
            (json['roles'] as List?)?.map((r) => r as String).toList() ?? const [],
        status: json['status'] as String? ?? 'active',
        defaultCityId: (json['defaultCityId'] as num?)?.toInt(),
        preferredLanguage: json['preferredLanguage'] as String? ?? 'hi',
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.now(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'phone': phone,
        'name': name,
        'roles': roles,
        'status': status,
        'defaultCityId': defaultCityId,
        'preferredLanguage': preferredLanguage,
        'createdAt': createdAt.toIso8601String(),
      };
}

/// What `POST /auth/otp/verify` and `POST /auth/refresh` return.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.expiresIn,
    required this.refreshToken,
    required this.refreshExpiresAt,
    required this.user,
    required this.isNewUser,
  });

  final String accessToken;

  /// Seconds. 900 by default.
  final int expiresIn;

  /// Opaque and **single use** — presenting a rotated one revokes every token
  /// for the device. Only ApiClient may spend it.
  final String refreshToken;

  final DateTime refreshExpiresAt;
  final AuthUser user;

  /// True on the very first verification, when the account was created by
  /// this call. The app asks for a name only then.
  final bool isNewUser;

  factory AuthSession.fromJson(Map<String, dynamic> json) => AuthSession(
        accessToken: json['accessToken'] as String,
        expiresIn: (json['expiresIn'] as num).toInt(),
        refreshToken: json['refreshToken'] as String,
        refreshExpiresAt:
            DateTime.tryParse(json['refreshExpiresAt'] as String? ?? '') ??
                DateTime.now().add(const Duration(days: 30)),
        user: AuthUser.fromJson((json['user'] as Map).cast<String, dynamic>()),
        isNewUser: json['isNewUser'] as bool? ?? false,
      );
}

/// What `POST /auth/otp/request` returns. The code itself is never in here —
/// it never leaves the server, and only its HMAC is stored.
class OtpChallenge {
  const OtpChallenge({
    required this.maskedPhone,
    required this.expiresInSeconds,
  });

  final String maskedPhone;
  final int expiresInSeconds;

  factory OtpChallenge.fromJson(Map<String, dynamic> json) => OtpChallenge(
        maskedPhone: json['phone'] as String? ?? '',
        expiresInSeconds: (json['expiresInSeconds'] as num?)?.toInt() ?? 300,
      );
}
