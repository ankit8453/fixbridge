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

/// Where the app stands with the permission, before asking for anything.
///
/// This exists because the system prompt is a **finite resource**. Android
/// stops showing it after two denials, for the life of the install — so an app
/// that spends both without explaining itself is locked out permanently, and
/// the customer is left panning a map by hand forever.
enum LocationPermissionState {
  /// Already granted. Read the fix; prompt nobody.
  granted,

  /// Not granted, and the system will still show a prompt. One of the two.
  canAsk,

  /// Denied twice, or blocked by policy. Only the settings screen can undo it.
  blocked,

  /// Location is off for the whole phone. Nothing to do with our permission.
  serviceOff,
}

/// Reading the device's location.
///
/// Every caller must handle refusal — there is always a manual fallback, and
/// nothing in either app is allowed to become unusable because somebody said
/// no to a permission prompt.
///
/// **Asking and reading are separate on purpose.** [currentIfAllowed] never
/// prompts, and is what background and data-loading paths use; [requestAndGet]
/// prompts, and belongs only behind a screen that has just explained why.
/// Android's own guidance is to ask in context, at the moment the feature is
/// used — and since the prompt runs out after two refusals, firing it from a
/// list that happens to be loading spends a chance the customer never saw.
abstract final class DeviceLocation {
  const DeviceLocation._();

  /// Where we stand, without asking for anything.
  static Future<LocationPermissionState> permissionState() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationPermissionState.serviceOff;
    }

    return switch (await Geolocator.checkPermission()) {
      LocationPermission.always ||
      LocationPermission.whileInUse =>
        LocationPermissionState.granted,
      LocationPermission.deniedForever => LocationPermissionState.blocked,
      _ => LocationPermissionState.canAsk,
    };
  }

  /// A fix, **only if permission already exists**. Never prompts.
  ///
  /// What every automatic path uses: the home screen resolving where "near me"
  /// means, a search refreshing. A prompt fired from one of those arrives with
  /// no explanation attached to it, which is the version people refuse.
  static Future<LocationResult> currentIfAllowed({
    Duration timeout = const Duration(seconds: 12),
  }) async {
    final state = await permissionState();

    return switch (state) {
      LocationPermissionState.granted => _read(timeout),
      LocationPermissionState.serviceOff =>
        const LocationRefused(LocationDenial.serviceOff),
      LocationPermissionState.blocked =>
        const LocationRefused(LocationDenial.deniedForever),
      LocationPermissionState.canAsk =>
        const LocationRefused(LocationDenial.denied),
    };
  }

  /// Asks, then reads.
  ///
  /// Call this **only** from somewhere that has just told the customer what
  /// the location is for. One of two chances is spent here.
  ///
  /// [medium] accuracy on purpose: this positions somebody to within a block,
  /// which is all a five-kilometre service radius needs, and it returns far
  /// faster and on far less battery than a GPS-grade fix.
  static Future<LocationResult> requestAndGet({
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

    return _read(timeout);
  }

  static Future<LocationResult> _read(Duration timeout) async {
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

  /// Opens the app's own settings page, for the deniedForever case.
  static Future<void> openSettings() => Geolocator.openAppSettings();

  /// Opens the device location settings, for the serviceOff case.
  static Future<void> openLocationSettings() =>
      Geolocator.openLocationSettings();
}
