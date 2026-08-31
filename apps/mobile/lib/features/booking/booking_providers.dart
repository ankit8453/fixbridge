import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/env.dart';
import '../../core/providers.dart';
import '../../data/models/booking.dart';
import '../../data/models/payment.dart';
import '../home/home_providers.dart';

/// One booking, re-fetched on a timer.
///
/// There is no realtime anywhere in the API — no WebSocket, no SSE — so this
/// screen is a poller, and the cadence is a battery decision as much as a UI
/// one:
///
/// * **10s while REQUESTED.** The customer is staring at the screen waiting
///   for somebody to answer; this is the anxious minute of the whole flow.
/// * **20s once accepted.** Still live, but nobody is watching every second.
/// * **Stopped on a terminal status.** Nothing will ever change again, so
///   polling on would be pure waste.
/// * **Stopped when the app is backgrounded**, with one immediate re-fetch on
///   resume — a phone in a pocket should not be making requests.
class BookingPoller extends StateNotifier<AsyncValue<Booking>>
    with WidgetsBindingObserver {
  BookingPoller(this._ref, this.bookingId) : super(const AsyncValue.loading()) {
    WidgetsBinding.instance.addObserver(this);
    unawaited(refresh());
  }

  final Ref _ref;
  final String bookingId;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(refresh());
    } else {
      _timer?.cancel();
    }
  }

  Future<void> refresh() async {
    try {
      final booking =
          await _ref.read(bookingRepositoryProvider).byId(bookingId);
      if (!mounted) return;
      state = AsyncValue.data(booking);
      _schedule(booking.status);
    } catch (e, st) {
      if (!mounted) return;
      // A failed poll keeps the last good booking on screen rather than
      // replacing a live job with an error page — the network drops
      // constantly and the previous state is still the best guess.
      if (!state.hasValue) state = AsyncValue.error(e, st);
      _schedule(state.valueOrNull?.status);
    }
  }

  void _schedule(BookingStatus? status) {
    _timer?.cancel();
    if (status == null || status.isTerminal) return;

    final interval =
        status == BookingStatus.requested ? Env.pollWaiting : Env.pollActive;
    _timer = Timer(interval, refresh);
  }

  /// Applies a booking the caller already has — after a cancel or an approve
  /// — so the screen updates immediately instead of waiting for the next tick.
  void apply(Booking booking) {
    if (!mounted) return;
    state = AsyncValue.data(booking);
    _ref.invalidate(myBookingsProvider);
    _schedule(booking.status);
  }
}

final bookingProvider = StateNotifierProvider.autoDispose
    .family<BookingPoller, AsyncValue<Booking>, String>((ref, id) {
  return BookingPoller(ref, id);
});

/// Payments against a booking.
///
/// Polled separately and only while a payment is awaiting the webhook: a
/// successful checkout does not mean captured, and this is what turns
/// "confirming your payment" into "paid".
final bookingPaymentsProvider = FutureProvider.autoDispose
    .family<List<Payment>, String>((ref, bookingId) async {
  final payments =
      await ref.watch(bookingRepositoryProvider).payments(bookingId);

  final pending = payments.any((p) => p.isAwaitingConfirmation);
  if (pending) {
    // Re-arm until the webhook lands. Only while something is genuinely in
    // flight, so a settled booking costs nothing.
    //
    // The timer is cancelled on dispose rather than checked for liveness,
    // because a FutureProvider's ref has no `mounted` to ask.
    final timer = Timer(Env.pollPayment, ref.invalidateSelf);
    ref.onDispose(timer.cancel);
  }

  return payments;
});

/// The quotation waiting for a decision, if there is one.
final pendingQuotationProvider =
    Provider.autoDispose.family<dynamic, String>((ref, bookingId) {
  return ref.watch(bookingProvider(bookingId)).valueOrNull?.pendingQuotation;
});
