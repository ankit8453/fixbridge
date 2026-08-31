/// Screen re-exports, so the router imports one file rather than nine.
///
/// The name is now a leftover: this held stub screens while the booking half
/// of the app was unbuilt, and every one of them has since been replaced by
/// the real thing. Kept as a barrel because the router reads better for it.
library;

export '../features/account/account_screen.dart';
export '../features/booking/booking_screen.dart';
export '../features/bookings/bookings_screen.dart';
export '../features/notifications/notifications_screen.dart';
export '../features/provider/provider_screen.dart';
export '../features/search/search_screen.dart';
