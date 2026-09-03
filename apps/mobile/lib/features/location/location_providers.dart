import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/location.dart';
import '../../core/providers.dart';
import '../../data/models/address.dart';
import '../provider/provider_providers.dart';

/// Jabalpur city centre — the origin of last resort.
///
/// Used only when there is nothing better: no saved address, and either a
/// refused permission or a fix that never arrived. Searching from here is
/// wrong for everybody not standing in the middle of town, which is why it is
/// a fallback and never a default.
const cityCentre = (lat: 23.1815, lng: 79.9864);

/// Where the customer is, as far as the app can tell.
enum LocationSource {
  /// A saved address, named and chosen. The best answer.
  address,

  /// The device's own fix, named by the platform geocoder where it can.
  device,

  /// Nothing worked. Distances are being measured from the city centre and
  /// the UI must say so.
  fallback,
}

class ResolvedLocation {
  const ResolvedLocation({
    required this.lat,
    required this.lng,
    required this.source,
    this.address,
    this.placeName,
  });

  final double lat;
  final double lng;
  final LocationSource source;

  /// Set only when [source] is [LocationSource.address].
  final Address? address;

  /// What the platform geocoder calls this point, when it can name it.
  /// Set only when [source] is [LocationSource.device], and often null.
  final String? placeName;

  bool get isGuess => source == LocationSource.fallback;

  /// The short name for the header — "Home", the neighbourhood the phone is
  /// standing in, or an admission that we are guessing.
  String get label => switch (source) {
        LocationSource.address => address!.displayLabel,
        // The generic wording is the fallback, not the answer: it appears only
        // when the geocoder had no name to give.
        LocationSource.device => placeName ?? 'Current location',
        LocationSource.fallback => 'Set your location',
      };

  /// The line underneath it, where there is one worth showing.
  String? get detail => switch (source) {
        LocationSource.address => address!.shortLine,
        LocationSource.device => placeName == null ? null : 'Current location',
        LocationSource.fallback => 'Showing Jabalpur city centre',
      };
}

/// A saved address the customer picked by hand, overriding the default.
///
/// Held here rather than in the widget so the choice survives moving between
/// the home and search screens — picking "Mummy's flat" and then opening
/// search should not silently snap back to Home.
final pickedAddressProvider = StateProvider<Address?>((ref) => null);

/// Set when the customer explicitly asks for the device's location.
///
/// This has to be recorded rather than inferred from "no address is picked".
/// The resolver prefers a saved address over a device fix — rightly, since a
/// returning customer should never be prompted — so once Home exists, simply
/// clearing the pick lands straight back on Home, and "Use my current
/// location" is overruled by the very address it was chosen to override. That
/// is the bug where the button appeared to do nothing at all.
final useDeviceLocationProvider = StateProvider<bool>((ref) => false);

/// Where to search from, and what to call it.
///
/// The order is deliberate:
///
///   1. an address the customer explicitly picked,
///   2. their default saved address — no permission needed at all, so a
///      returning customer is never prompted,
///   3. the device's location. **This is where the permission prompt lives.**
///      By this point there is genuinely nothing else to go on, and the
///      customer is looking at a screen whose whole job is "who is near me".
///   4. the last fix that worked, so a refusal does not re-prompt and re-fail
///      on every launch,
///   5. the city centre, admitted as a guess.
final resolvedLocationProvider = FutureProvider<ResolvedLocation>((ref) async {
  final store = ref.read(sessionStoreProvider);

  final picked = ref.watch(pickedAddressProvider);
  if (picked != null) {
    return ResolvedLocation(
      lat: picked.lat,
      lng: picked.lng,
      source: LocationSource.address,
      address: picked,
    );
  }

  // Skipped entirely when the device was asked for by name, so that choice
  // survives having a saved address.
  if (!ref.watch(useDeviceLocationProvider)) {
    // A saved address already carries coordinates — the server geocodes from
    // the text when the phone did not supply them, so these are resolved.
    final addresses = await ref.watch(myAddressesProvider.future);
    if (addresses.isNotEmpty) {
      final chosen = addresses.firstWhere(
        (a) => a.isDefault,
        orElse: () => addresses.first,
      );
      return ResolvedLocation(
        lat: chosen.lat,
        lng: chosen.lng,
        source: LocationSource.address,
        address: chosen,
      );
    }
  }

  // Asks, on a phone that has not been asked yet. Returns without prompting
  // once the answer is a permanent no, so this cannot nag.
  final fix = await DeviceLocation.current();
  if (fix is LocationFound) {
    await store.setLastLocation(fix.lat, fix.lng);
    return ResolvedLocation(
      lat: fix.lat,
      lng: fix.lng,
      source: LocationSource.device,
      placeName: await DeviceLocation.describe(fix.lat, fix.lng),
    );
  }

  final saved = store.lastLocation;
  if (saved != null) {
    return ResolvedLocation(
      lat: saved.$1,
      lng: saved.$2,
      source: LocationSource.device,
      placeName: await DeviceLocation.describe(saved.$1, saved.$2),
    );
  }

  return ResolvedLocation(
    lat: cityCentre.lat,
    lng: cityCentre.lng,
    source: LocationSource.fallback,
  );
});
