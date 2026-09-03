import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';

/// Why a location request did not produce a location.
///
/// Separate cases rather than one failure, because the fix is different every
/// time and a single "could not get location" leaves somebody tapping a button
/// that will never work. Refusal is not an error state — it is a choice, and
/// the caller offers the manual path instead.
enum LocationDenial {
  /// Location is switched off for the whole device.
  serviceOff,

  /// Refused this time. Asking again is allowed.
  denied,

  /// Refused permanently; only the system settings screen can undo it.
  deniedForever,

  /// Granted, but no fix arrived in time.
  timedOut,
}

/// A point, or the reason there isn't one.
sealed class LocationResult {
  const LocationResult();
}

class LocationFound extends LocationResult {
  const LocationFound(this.lat, this.lng);
  final double lat;
  final double lng;
}

class LocationRefused extends LocationResult {
  const LocationRefused(this.reason);
  final LocationDenial reason;

  /// What to actually show somebody. Each one names the next step.
  String get message => switch (reason) {
        LocationDenial.serviceOff =>
          'Location is switched off on this phone. Turn it on, or set your '
              'area by hand.',
        LocationDenial.denied =>
          'We could not read your location. You can allow it, or set your '
              'area by hand.',
        LocationDenial.deniedForever =>
          'Location is blocked for this app in your phone settings. You can '
              'set your area by hand instead.',
        LocationDenial.timedOut =>
          'Could not get a location fix. Try again outdoors, or set your area '
              'by hand.',
      };

  /// Whether pointing at the system settings screen would help.
  bool get settingsWouldHelp =>
      reason == LocationDenial.deniedForever ||
      reason == LocationDenial.serviceOff;
}

/// Reading the device's location.
///
/// Every caller must handle refusal — there is always a manual fallback, and
/// nothing in either app is allowed to become unusable because somebody said
/// no to a permission prompt.
abstract final class DeviceLocation {
  const DeviceLocation._();

  /// A single fix, asking for permission if it has not been asked yet.
  ///
  /// [medium] accuracy on purpose: this positions somebody to within a
  /// block, which is all a five-kilometre service radius needs, and it
  /// returns far faster and on far less battery than a GPS-grade fix.
  static Future<LocationResult> current({
    Duration timeout = const Duration(seconds: 12),
  }) async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const LocationRefused(LocationDenial.serviceOff);
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (permission == LocationPermission.deniedForever) {
      return const LocationRefused(LocationDenial.deniedForever);
    }
    if (permission == LocationPermission.denied) {
      return const LocationRefused(LocationDenial.denied);
    }

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: timeout,
        ),
      );
      return LocationFound(position.latitude, position.longitude);
    } catch (_) {
      // Includes the timeout, and the several platform errors that all mean
      // the same thing to somebody standing there waiting: no fix.
      return const LocationRefused(LocationDenial.timedOut);
    }
  }

  /// A short place name for a point — "Surtalai", "Adhartal" — or null.
  ///
  /// Uses the geocoder built into the operating system, so it costs nothing
  /// and needs no key. It is genuinely allowed to fail: a phone without Play
  /// services, without a network, or simply standing somewhere the geocoder
  /// has no name for returns nothing, and the caller shows the generic label
  /// instead. Nothing about the booking depends on this string.
  static Future<String?> describe(double lat, double lng) async {
    try {
      // geocoding 5 moved this from a top-level function onto a class. The
      // instance is cheap and holds nothing worth keeping between calls.
      final places = await Geocoding()
          .placemarkFromCoordinates(lat, lng)
          .timeout(const Duration(seconds: 6));
      if (places.isEmpty) return null;

      final place = places.first;
      // Most specific first. `subLocality` is the neighbourhood, which is what
      // somebody in Jabalpur would actually say; `locality` is the city, which
      // is right for anyone just outside it. Street and house number are
      // deliberately skipped — a header reading "113" helps nobody.
      for (final candidate in [
        place.subLocality,
        place.locality,
        place.subAdministrativeArea,
      ]) {
        final name = candidate?.trim();
        if (name != null && name.isNotEmpty) return name;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Opens the app's own settings page, for the deniedForever case.
  static Future<void> openSettings() => Geolocator.openAppSettings();

  /// Opens the device location settings, for the serviceOff case.
  static Future<void> openLocationSettings() =>
      Geolocator.openLocationSettings();
}
