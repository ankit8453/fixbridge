/// One item in the inbox.
///
/// Rendered server-side in the account's stored `preferredLanguage`, **not**
/// the request's `Accept-Language` — deliberately, so the inbox agrees with
/// the WhatsApp message already on the phone. Changing the language is
/// retroactive: old rows re-render from their stored template keys.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.topic,
    required this.title,
    required this.body,
    required this.deepLink,
    required this.criticality,
    required this.read,
    required this.createdAt,
  });

  final String id;

  /// `booking.accepted`, `quotation.sent`, and so on. Used to pick an icon.
  final String topic;

  final String title;
  final String body;

  /// An already-resolved path such as `booking/9f3c…`. Route it; never show it.
  final String? deepLink;

  /// `critical` or `standard`. Only two levels, on purpose — a scale with
  /// five means everything ends up in the middle.
  final String criticality;

  final bool read;
  final DateTime createdAt;

  bool get isCritical => criticality == 'critical';

  /// The family the topic belongs to, for grouping and iconography.
  String get group => topic.split('.').first;

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id'] as String,
        topic: json['topic'] as String? ?? '',
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        deepLink: json['deepLink'] as String?,
        criticality: json['criticality'] as String? ?? 'standard',
        read: json['read'] as bool? ?? false,
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
      );
}

/// A page of the inbox.
class NotificationPage {
  const NotificationPage({
    required this.notifications,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.unread,
  });

  final List<AppNotification> notifications;
  final int page;
  final int pageSize;
  final int total;
  final int unread;

  bool get hasMore => page * pageSize < total;

  factory NotificationPage.fromJson(Map<String, dynamic> json) =>
      NotificationPage(
        notifications: (json['notifications'] as List?)
                ?.map((n) => AppNotification.fromJson(
                    (n as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
        page: (json['page'] as num?)?.toInt() ?? 1,
        pageSize: (json['pageSize'] as num?)?.toInt() ?? 20,
        total: (json['total'] as num?)?.toInt() ?? 0,
        unread: (json['unread'] as num?)?.toInt() ?? 0,
      );
}
