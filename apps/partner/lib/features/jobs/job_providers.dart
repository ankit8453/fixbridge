import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/models/booking.dart';
import '../home/partner_providers.dart';

/// One job, re-fetched on a timer.
///
/// The technician drives most transitions themselves, so this polls slower
/// than the customer's screen does. What it is actually watching for is the
/// *other* side moving: a quotation being approved or rejected, or the
/// customer cancelling before arrival.
class JobPoller extends StateNotifier<AsyncValue<Booking>>
    with WidgetsBindingObserver {
  JobPoller(this._ref, this.bookingId) : super(const AsyncValue.loading()) {
    WidgetsBinding.instance.addObserver(this);
    unawaited(refresh());
  }

  final Ref _ref;
  final String bookingId;
  Timer? _timer;

  static const _interval = Duration(seconds: 20);

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
          await _ref.read(partnerRepositoryProvider).booking(bookingId);
      if (!mounted) return;
      state = AsyncValue.data(booking);
      _schedule(booking.status);
    } catch (e, st) {
      if (!mounted) return;
      if (!state.hasValue) state = AsyncValue.error(e, st);
      _schedule(state.valueOrNull?.status);
    }
  }

  void _schedule(BookingStatus? status) {
    _timer?.cancel();
    // A finished job will never change again.
    if (status == null || status.isTerminal) return;
    _timer = Timer(_interval, refresh);
  }

  /// Applies a booking the caller already has, after a transition they made
  /// themselves, so the screen moves at once rather than on the next tick.
  void apply(Booking booking) {
    if (!mounted) return;
    state = AsyncValue.data(booking);
    _ref.read(jobsProvider.notifier).apply(booking);
    _schedule(booking.status);
  }
}

final jobProvider = StateNotifierProvider.autoDispose
    .family<JobPoller, AsyncValue<Booking>, String>((ref, id) {
  return JobPoller(ref, id);
});

/// Payments recorded against a job — how the technician knows whether the
/// customer paid online or still owes cash.
final jobPaymentsProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>((ref, bookingId) async {
  return ref.watch(partnerRepositoryProvider).payments(bookingId);
});
