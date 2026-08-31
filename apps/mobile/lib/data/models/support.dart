/// A review, in either direction.
///
/// Which direction it is — and therefore which tags are legal — is derived
/// server-side from who the caller is, never from the request body. A customer
/// cannot post a provider→customer review by asking nicely.
class Review {
  const Review({
    required this.id,
    required this.bookingId,
    required this.direction,
    required this.stars,
    required this.tags,
    required this.text,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String bookingId;

  /// `customer_to_provider` or `provider_to_customer`.
  final String direction;

  final int stars;
  final List<String> tags;
  final String? text;

  /// `published` or `hidden`. A hidden review is excluded from aggregates
  /// without being deleted.
  final String status;

  final DateTime createdAt;

  bool get isMine => direction == 'customer_to_provider';

  factory Review.fromJson(Map<String, dynamic> json) => Review(
        id: json['id'] as String,
        bookingId: json['bookingId'] as String? ?? '',
        direction: json['direction'] as String? ?? 'customer_to_provider',
        stars: (json['stars'] as num?)?.toInt() ?? 0,
        tags:
            (json['tags'] as List?)?.map((t) => t as String).toList() ?? const [],
        text: json['text'] as String?,
        status: json['status'] as String? ?? 'published',
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
      );
}

/// The five tags a customer may put on a technician. The API validates
/// against its own list; this mirrors it so the chips can be drawn offline.
///
/// Note there is no negative tag here. The provider→customer set has one
/// (`difficult`) and it is deliberately internal-only — a public negative
/// tag is a brigading tool.
abstract final class ReviewTags {
  const ReviewTags._();

  static const customerToProvider = <String, String>{
    'punctual': 'Punctual',
    'polite': 'Polite',
    'fair_price': 'Fair price',
    'clean_work': 'Clean work',
    'expert': 'Expert',
  };

  /// The API caps a review at five tags.
  static const maxTags = 5;
}

/// A complaint raised by either party, from ARRIVED onwards.
class Complaint {
  const Complaint({
    required this.id,
    required this.bookingId,
    required this.category,
    required this.description,
    required this.status,
    required this.raisedByUserId,
    required this.againstUserId,
    required this.resolutionNote,
    required this.severity,
    required this.createdAt,
    required this.resolvedAt,
  });

  final String id;
  final String bookingId;
  final String category;
  final String description;

  /// `open`, `in_review`, `resolved` or `dismissed`.
  final String status;

  final String raisedByUserId;
  final String againstUserId;
  final String? resolutionNote;

  /// `minor`, `major` or `severe`, set only when resolved. A dismissal
  /// carries no severity — it counts for nothing against anybody.
  final String? severity;

  final DateTime createdAt;
  final DateTime? resolvedAt;

  bool get isOpen => status == 'open' || status == 'in_review';

  factory Complaint.fromJson(Map<String, dynamic> json) => Complaint(
        id: json['id'] as String,
        bookingId: json['bookingId'] as String? ?? '',
        category: json['category'] as String? ?? 'other',
        description: json['description'] as String? ?? '',
        status: json['status'] as String? ?? 'open',
        raisedByUserId: json['raisedByUserId'] as String? ?? '',
        againstUserId: json['againstUserId'] as String? ?? '',
        resolutionNote: json['resolutionNote'] as String?,
        severity: json['severity'] as String?,
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '')?.toLocal() ??
                DateTime.now(),
        resolvedAt:
            DateTime.tryParse(json['resolvedAt'] as String? ?? '')?.toLocal(),
      );
}

/// The seven complaint categories the API accepts.
///
/// `safety` is not like the others: a safety complaint from a customer
/// suspends the technician *before* the request returns. It is handled
/// synchronously for that reason, and the UI should say so plainly.
abstract final class ComplaintCategories {
  const ComplaintCategories._();

  static const all = <String, String>{
    'overcharge': 'I was overcharged',
    'no_show': 'They did not turn up',
    'quality': 'The work was poor',
    'behavior': 'How I was treated',
    'cash_dispute': 'A dispute about cash',
    'safety': 'I felt unsafe',
    'other': 'Something else',
  };

  static const minDescription = 10;
  static const maxDescription = 1000;
}

/// Why a customer is cancelling. The API validates against the caller's own
/// list — a provider reason sent by a customer is a 400.
abstract final class CancelReasons {
  const CancelReasons._();

  static const customer = <String, String>{
    'changed_mind': 'I changed my mind',
    'found_other': 'I found someone else',
    'emergency': 'Something urgent came up',
    'provider_delay': 'They are taking too long',
    'other': 'Another reason',
  };
}
