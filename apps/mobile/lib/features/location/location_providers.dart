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

  /// The device's own fix. Accurate, but we cannot name it without a reverse
  /// geocoder, and there is no endpoint for that.
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
  });

  final double lat;
  final double lng;
  final LocationSource source;

  /// Set only when [source] is [LocationSource.address].
  final Address? address;

  bool get isGuess => source == LocationSource.fallback;

  /// The short name for the header — "Home", "Current location", or an
  /// admission that we are guessing.
  String get label => switch (source) {
        LocationSource.address => address!.displayLabel,
        LocationSource.device => 'Current location',
        LocationSource.fallback => 'Set your location',
      };

  /// The line underneath it, where there is one worth showing.
  String? get detail => switch (source) {
        LocationSource.address => address!.shortLine,
        LocationSource.device => null,
        LocationSource.fallback => 'Showing Jabalpur city centre',
      };
}

/// A saved address the customer picked by hand, overriding the default.
///
/// Held here rather than in the widget so the choice survives moving between
/// the home and search screens — picking "Mummy's flat" and then opening
/// search should not silently snap back to Home.
final pickedAddressProvider = StateProvider<Address?>((ref) => null);

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

  // A saved address already carries coordinates — the server geocodes from the
  // text when the phone did not supply them, so these are always resolved.
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

  // Asks, on a phone that has not been asked yet. Returns without prompting
  // once the answer is a permanent no, so this cannot nag.
  final fix = await DeviceLocation.current();
  if (fix is LocationFound) {
    await store.setLastLocation(fix.lat, fix.lng);
    return ResolvedLocation(
      lat: fix.lat,
      lng: fix.lng,
      source: LocationSource.device,
    );
  }

  final saved = store.lastLocation;
  if (saved != null) {
    return ResolvedLocation(
      lat: saved.$1,
      lng: saved.$2,
      source: LocationSource.device,
    );
  }

  return ResolvedLocation(
    lat: cityCentre.lat,
    lng: cityCentre.lng,
    source: LocationSource.fallback,
  );
});
