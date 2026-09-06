import '../../core/api/api_client.dart';

/// One place the customer could mean.
class PlaceSuggestion {
  const PlaceSuggestion({
    required this.label,
    required this.lat,
    required this.lng,
  });

  /// What to show in the list — "Vijay Nagar, Jabalpur, Madhya Pradesh".
  final String label;
  final double lat;
  final double lng;

  static PlaceSuggestion? fromJson(Map<String, dynamic> json) {
    final point = (json['point'] as Map?)?.cast<String, dynamic>();
    final lat = (point?['lat'] as num?)?.toDouble();
    final lng = (point?['lng'] as num?)?.toDouble();
    final label = json['label'] as String?;

    if (lat == null || lng == null || label == null) return null;
    return PlaceSuggestion(label: label, lat: lat, lng: lng);
  }
}

/// What a point is called, and whether we serve it.
class PlaceName {
  const PlaceName({required this.label, required this.servedHere});

  /// The neighbourhood — "Surtalai". Null when nothing could name it.
  final String? label;

  /// False when the point is outside Jabalpur. The picker refuses to confirm.
  final bool servedHere;
}

/// Map lookups, which happen on our server rather than on the phone.
///
/// Not because the phone could not call OpenStreetMap directly, but because
/// their free service allows the **whole application** one request per second
/// and bans the IP for exceeding it. Only a server can hold a queue that means
/// anything — one phone cannot know what the others are doing. It also lets
/// every lookup be cached once for everybody.
class GeoRepository {
  GeoRepository(this._api);

  final ApiClient _api;

  /// Candidates for what the customer typed.
  ///
  /// Never throws for a query that simply matched nothing — an empty list is a
  /// normal answer, and a search box that shows an error stops somebody in the
  /// middle of entering their address.
  Future<List<PlaceSuggestion>> search(String query) async {
    if (query.trim().length < 3) return const [];

    final json = await _api.get<Map<String, dynamic>>(
      '/geo/search',
      query: {'q': query.trim()},
    );

    final results = (json['results'] as List?) ?? const [];

    return results
        .whereType<Map>()
        .map((row) => PlaceSuggestion.fromJson(row.cast<String, dynamic>()))
        .whereType<PlaceSuggestion>()
        .toList();
  }

  /// What this point is called.
  Future<PlaceName> reverse(double lat, double lng) async {
    final json = await _api.get<Map<String, dynamic>>(
      '/geo/reverse',
      query: {'lat': lat, 'lng': lng},
    );

    return PlaceName(
      label: json['label'] as String?,
      servedHere: json['servedHere'] as bool? ?? true,
    );
  }
}
