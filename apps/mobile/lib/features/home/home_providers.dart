import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/models/booking.dart';
import '../../data/models/category.dart';
import '../auth/auth_controller.dart';

/// The service tree.
///
/// Cached for the session — the counts inside are already five minutes stale
/// server-side, so re-fetching on every visit to Home buys nothing and costs
/// a request on a connection that may not have one to spare.
final categoriesProvider = FutureProvider<List<ServiceCategory>>((ref) async {
  final store = ref.watch(sessionStoreProvider);
  return ref.watch(catalogRepositoryProvider).categories(cityId: store.cityId);
});

/// The customer's bookings, newest first.
///
/// Only fetched when signed in — browsing works without an account, and
/// asking for someone's bookings before they have one is a guaranteed 401.
final myBookingsProvider = FutureProvider<List<Booking>>((ref) async {
  final auth = ref.watch(authControllerProvider);
  if (!auth.isSignedIn) return const [];

  final bookings = await ref.watch(bookingRepositoryProvider).list();
  bookings.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return bookings;
});

/// The one booking that is happening right now, if there is one.
///
/// Drives the live card on Home. Only ever one: a customer with two jobs
/// running at once is not a case worth designing the home screen around, and
/// the most recent is the one they mean.
final liveBookingProvider = Provider<Booking?>((ref) {
  final bookings = ref.watch(myBookingsProvider).valueOrNull;
  if (bookings == null) return null;

  for (final booking in bookings) {
    if (booking.status.isLive) return booking;
  }
  return null;
});

/// Bookings that are finished, for the list on the Bookings tab.
final pastBookingsProvider = Provider<List<Booking>>((ref) {
  final bookings = ref.watch(myBookingsProvider).valueOrNull ?? const [];
  return bookings.where((b) => b.status.isTerminal).toList();
});

/// The unread badge on the bell.
final unreadCountProvider = FutureProvider<int>((ref) async {
  final auth = ref.watch(authControllerProvider);
  if (!auth.isSignedIn) return 0;
  return ref.watch(accountRepositoryProvider).unreadCount();
});
