/// A node in the service tree from `GET /categories`.
///
/// Clusters (Electrical) hold services (Fan repair); a leaf has an empty
/// [children]. Both arrive in one tree, so the app never round-trips to expand.
class ServiceCategory {
  const ServiceCategory({
    required this.id,
    required this.slug,
    required this.name,
    required this.nameKey,
    required this.icon,
    required this.sortOrder,
    required this.providerCount,
    required this.children,
  });

  final int id;
  final String slug;

  /// Already localised by the server in the caller's Accept-Language.
  final String name;

  /// The i18n key behind [name], so a client can re-localise without a call.
  final String nameKey;

  final String? icon;
  final int sortOrder;

  /// Listed, verified and active providers only — and **cached five minutes
  /// server-side**. It is a browsing hint, not a live count, so the UI says
  /// "14 nearby" rather than presenting it as an exact figure.
  final int providerCount;

  final List<ServiceCategory> children;

  bool get isCluster => children.isNotEmpty;

  factory ServiceCategory.fromJson(Map<String, dynamic> json) =>
      ServiceCategory(
        id: (json['id'] as num).toInt(),
        slug: json['slug'] as String,
        name: json['name'] as String,
        nameKey: json['nameKey'] as String? ?? '',
        icon: json['icon'] as String?,
        sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
        providerCount: (json['providerCount'] as num?)?.toInt() ?? 0,
        children: (json['children'] as List?)
                ?.map((c) => ServiceCategory.fromJson(
                    (c as Map).cast<String, dynamic>()))
                .toList() ??
            const [],
      );
}

/// A suggestion from `GET /search/resolve` — free text, in either script,
/// mapped to a category. Called as the customer types.
class CategorySuggestion {
  const CategorySuggestion({
    required this.categoryId,
    required this.slug,
    required this.name,
    required this.parentId,
    required this.confidence,
    required this.matchedTerm,
  });

  final int categoryId;
  final String slug;
  final String name;

  /// Null for a cluster; the parent's id for a service.
  final int? parentId;

  /// 0..1. An exact synonym match is 1.
  final double confidence;

  final String? matchedTerm;

  factory CategorySuggestion.fromJson(Map<String, dynamic> json) =>
      CategorySuggestion(
        categoryId: (json['categoryId'] as num).toInt(),
        slug: json['slug'] as String,
        name: json['name'] as String,
        parentId: (json['parentId'] as num?)?.toInt(),
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
        matchedTerm: json['matchedTerm'] as String?,
      );
}
