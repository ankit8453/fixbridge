/// A saved address. Every query is scoped to the caller server-side, so
/// another person's address simply does not exist to this app.
class Address {
  const Address({
    required this.id,
    required this.label,
    required this.labelText,
    required this.addressText,
    required this.landmark,
    required this.cityId,
    required this.lat,
    required this.lng,
    required this.isDefault,
  });

  final String id;

  /// `home`, `shop` or `other`.
  final String label;

  /// A free-text name when `other` is too vague — "Mummy's flat".
  final String? labelText;

  final String addressText;
  final String? landmark;
  final int cityId;

  /// Present when the phone had GPS at save time; otherwise the server
  /// geocoded from the text and these still come back resolved.
  final double lat;
  final double lng;

  final bool isDefault;

  String get displayLabel {
    if (labelText != null && labelText!.isNotEmpty) return labelText!;
    return switch (label) {
      'home' => 'Home',
      'shop' => 'Shop',
      _ => 'Other',
    };
  }

  /// One line for a picker row, landmark included because that is how people
  /// actually recognise their own address.
  String get shortLine {
    final l = landmark;
    if (l == null || l.isEmpty) return addressText;
    return '$addressText, near $l';
  }

  factory Address.fromJson(Map<String, dynamic> json) {
    final location = json['location'] as Map?;
    return Address(
      id: json['id'] as String? ?? '',
      label: json['label'] as String? ?? 'other',
      labelText: json['labelText'] as String?,
      addressText: json['addressText'] as String? ?? '',
      landmark: json['landmark'] as String?,
      cityId: (json['cityId'] as num?)?.toInt() ?? 0,
      lat: (location?['lat'] as num?)?.toDouble() ?? 0,
      lng: (location?['lng'] as num?)?.toDouble() ?? 0,
      isDefault: json['isDefault'] as bool? ?? false,
    );
  }
}

/// The customer's own profile row.
class CustomerProfile {
  const CustomerProfile({
    required this.userId,
    required this.displayName,
    required this.email,
  });

  final String userId;
  final String? displayName;
  final String? email;

  factory CustomerProfile.fromJson(Map<String, dynamic> json) =>
      CustomerProfile(
        userId: json['userId'] as String,
        displayName: json['displayName'] as String?,
        email: json['email'] as String?,
      );
}
