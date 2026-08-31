import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/models/address.dart';
import '../../data/models/provider.dart';
import '../../data/repositories/catalog_repository.dart';
import '../auth/auth_controller.dart';

final providerProfileProvider =
    FutureProvider.autoDispose.family<ProviderProfile, String>((ref, id) {
  return ref.watch(catalogRepositoryProvider).profile(id);
});

/// Open slots for the next week.
///
/// Only `open` slots come back — a booked hour is never disclosed, so this is
/// genuinely "when can they come", not "here is their diary".
final providerSlotsProvider =
    FutureProvider.autoDispose.family<List<ProviderSlot>, String>((ref, id) {
  final now = DateTime.now();
  return ref.watch(catalogRepositoryProvider).slots(
        id,
        from: now,
        to: now.add(const Duration(days: 7)),
      );
});

final providerReviewsProvider =
    FutureProvider.autoDispose.family<ReviewsPage, String>((ref, id) {
  return ref.watch(catalogRepositoryProvider).reviews(id);
});

/// The customer's saved addresses, for the booking sheet.
final myAddressesProvider = FutureProvider<List<Address>>((ref) async {
  if (!ref.watch(authControllerProvider).isSignedIn) return const [];
  return ref.watch(accountRepositoryProvider).addresses();
});
