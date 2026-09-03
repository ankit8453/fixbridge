import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/models/booking.dart';
import '../../data/models/partner_profile.dart';
import '../../data/models/profile_photo.dart';
import '../../data/models/trust.dart';
import '../../data/models/verification.dart';
import '../../data/models/payout_detail.dart';
import '../../data/models/wallet.dart';
import '../auth/auth_controller.dart';

/// The technician's own profile.
final partnerProfileProvider = FutureProvider<PartnerProfile>((ref) async {
  return ref.watch(partnerRepositoryProvider).profile();
});

/// The customer-facing display picture.
///
/// Separate from the profile itself because the URL is signed and short-lived
/// — bundling it into the profile would mean re-fetching everything whenever
/// it expired.
final profilePhotoProvider = FutureProvider<ProfilePhoto?>((ref) async {
  return ref.watch(partnerRepositoryProvider).photo();
});

final walletProvider = FutureProvider<Wallet>((ref) async {
  return ref.watch(partnerRepositoryProvider).wallet();
});

/// Where the next payout goes. Null until the technician has said.
final payoutDetailProvider = FutureProvider<PayoutDetail?>((ref) async {
  return ref.watch(partnerRepositoryProvider).payoutDetail();
});

final trustProvider = FutureProvider<Trust>((ref) async {
  return ref.watch(partnerRepositoryProvider).trust();
});

final verificationProvider = FutureProvider<VerificationSummary>((ref) async {
  return ref.watch(verificationRepositoryProvider).summary();
});

/// The technician's jobs, polled.
///
/// A request expires in an hour if nobody answers, and there is no push
/// channel in the API, so an open app is the only way a new job is noticed.
/// Polled every 30 seconds while foregrounded — often enough to be useful,
/// rare enough not to drain a battery on a work phone.
class JobsPoller extends StateNotifier<AsyncValue<List<Booking>>>
    with WidgetsBindingObserver {
  JobsPoller(this._ref, {bool enabled = true})
      : super(
            enabled ? const AsyncValue.loading() : const AsyncValue.data([])) {
    if (!enabled) return;
    WidgetsBinding.instance.addObserver(this);
    unawaited(refresh());
  }

  final Ref _ref;
  Timer? _timer;

  static const _interval = Duration(seconds: 30);

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
      final jobs = await _ref.read(partnerRepositoryProvider).bookings();
      if (!mounted) return;
      state = AsyncValue.data(jobs);
    } catch (e, st) {
      if (!mounted) return;
      // A failed poll keeps the last good list rather than replacing a
      // technician's day with an error page.
      if (!state.hasValue) state = AsyncValue.error(e, st);
    } finally {
      _schedule();
    }
  }

  void _schedule() {
    _timer?.cancel();
    if (!mounted) return;
    _timer = Timer(_interval, refresh);
  }

  /// Applies a job the caller already has, so a tap updates immediately
  /// rather than waiting for the next poll.
  void apply(Booking booking) {
    final current = state.valueOrNull;
    if (current == null || !mounted) return;

    state = AsyncValue.data([
      for (final job in current)
        if (job.id == booking.id) booking else job,
    ]);
  }
}

final jobsProvider =
    StateNotifierProvider<JobsPoller, AsyncValue<List<Booking>>>((ref) {
  // Signed out, or signed in without the technician role: nothing to poll
  // for, and asking would just be a guaranteed 401 or 403 every 30 seconds.
  final enabled = ref.watch(authControllerProvider).isSignedIn;
  return JobsPoller(ref, enabled: enabled);
});

/// Requests waiting for an answer. The clock is running on every one.
final pendingRequestsProvider = Provider<List<Booking>>((ref) {
  final jobs = ref.watch(jobsProvider).valueOrNull ?? const [];
  return jobs.where((j) => j.status == BookingStatus.requested).toList();
});

/// Jobs already accepted and not yet finished.
final activeJobsProvider = Provider<List<Booking>>((ref) {
  final jobs = ref.watch(jobsProvider).valueOrNull ?? const [];
  return jobs
      .where((j) => j.status.isLive && j.status != BookingStatus.requested)
      .toList();
});

final finishedJobsProvider = Provider<List<Booking>>((ref) {
  final jobs = ref.watch(jobsProvider).valueOrNull ?? const [];
  return jobs.where((j) => j.status.isTerminal).toList();
});

/// What this week's work came to.
///
/// Derived on the client because the API exposes no earnings summary — there
/// is no endpoint that answers "what did I make this week", so it is computed
/// from settled bookings.
final weekEarningsProvider = Provider<({int paise, int jobs})>((ref) {
  final jobs = ref.watch(jobsProvider).valueOrNull ?? const [];
  final weekAgo = DateTime.now().subtract(const Duration(days: 7));

  var paise = 0;
  var count = 0;
  for (final job in jobs) {
    if (job.status != BookingStatus.workDone) continue;
    if (job.createdAt.isBefore(weekAgo)) continue;
    paise += job.payablePaise ?? 0;
    count += 1;
  }
  return (paise: paise, jobs: count);
});

/// Whether the technician can actually receive work.
///
/// Two independent gates, and the API requires both: completeness makes a
/// profile findable, verification makes it trusted. Reported together so the
/// UI never says "you are 100% done" to somebody who still cannot be found.
final readinessProvider =
    Provider<({bool listed, bool verified, bool ready})>((ref) {
  final profile = ref.watch(partnerProfileProvider).valueOrNull;
  if (profile == null) return (listed: false, verified: false, ready: false);

  return (
    listed: profile.isListed,
    verified: profile.badge.isEarned,
    ready: profile.canReceiveWork,
  );
});
