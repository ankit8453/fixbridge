import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixbridge_partner/core/theme/app_colors.dart';
import 'package:fixbridge_partner/data/models/booking.dart';
import 'package:fixbridge_partner/data/models/trust.dart';
import 'package:fixbridge_partner/data/models/verification.dart';
import 'package:fixbridge_partner/data/models/wallet.dart';
import 'package:fixbridge_partner/features/jobs/job_status_ui.dart';

/// The rules that are expensive to get wrong on the technician's side.
void main() {
  group('wallet', () {
    test('reports the sign of a negative balance itself', () {
      // The API's own netDisplay is absolute-valued — the sign is stripped —
      // so rendering it alone on a negative balance shows a positive rupee
      // figure and is flatly wrong.
      const owing = Wallet(
        payablePaise: 20000,
        payableDisplay: '₹200',
        duesPaise: 80000,
        duesDisplay: '₹800',
        netPaise: -60000,
        pendingPayoutPaise: 0,
        payoutMinimumPaise: 50000,
        recentPayouts: [],
        ledger: [],
      );

      expect(owing.owesUs, isTrue);
      expect(owing.netDisplay, '₹600');
    });

    test('a positive balance is not flagged as owing', () {
      const owed = Wallet(
        payablePaise: 400000,
        payableDisplay: '₹4,000',
        duesPaise: 60000,
        duesDisplay: '₹600',
        netPaise: 340000,
        pendingPayoutPaise: 0,
        payoutMinimumPaise: 50000,
        recentPayouts: [],
        ledger: [],
      );

      expect(owed.owesUs, isFalse);
      expect(owed.netDisplay, '₹3,400');
    });

    test('knows when a balance is too small to be paid out', () {
      const small = Wallet(
        payablePaise: 20000,
        payableDisplay: '₹200',
        duesPaise: 0,
        duesDisplay: '₹0',
        netPaise: 20000,
        pendingPayoutPaise: 0,
        payoutMinimumPaise: 50000,
        recentPayouts: [],
        ledger: [],
      );

      // Rolls over rather than being transferred — worth saying so, because
      // a technician who expected money and got none assumes a bug.
      expect(small.belowMinimum, isTrue);
    });
  });

  group('verification', () {
    test('never offers the retired level 3', () {
      // The API's own `levelsRemaining` reports [0,1,2,3] for a brand-new
      // technician, and submitting 3 is a 400. Derived client-side instead.
      const fresh = VerificationSummary(
        badge: 'NONE',
        levelsPassed: [],
        cases: [],
      );

      expect(fresh.levelsRemaining, [0, 1, 2]);
      expect(fresh.levelsRemaining, isNot(contains(3)));
      expect(fresh.isVerified, isFalse);
    });

    test('is verified only when all three levels have passed', () {
      const two = VerificationSummary(
        badge: 'NONE',
        levelsPassed: [0, 1],
        cases: [],
      );
      expect(two.isVerified, isFalse);
      expect(two.levelsRemaining, [2]);

      const all = VerificationSummary(
        badge: 'VERIFIED',
        levelsPassed: [0, 1, 2],
        cases: [],
      );
      expect(all.isVerified, isTrue);
      expect(all.levelsRemaining, isEmpty);
    });
  });

  group('trust', () {
    test('a missing score is null, never zero', () {
      // Rendering null as 0 tells somebody they have failed when they have
      // simply not started.
      final fresh = Trust.fromJson(const {
        'score': null,
        'badge': 'NONE',
        'settledJobs': 0,
      });
      expect(fresh.score, isNull);
    });

    test('nextBand targets are absolute before there is a score', () {
      final fresh = Trust.fromJson(const {
        'score': null,
        'badge': 'NONE',
        'settledJobs': 0,
        'nextBand': {'band': 'SILVER', 'needsScore': 75, 'needsJobs': 10},
      });
      expect(fresh.nextBand!.isAbsolute, isTrue);

      final started = Trust.fromJson(const {
        'score': 72,
        'badge': 'VERIFIED',
        'settledJobs': 14,
        'nextBand': {'band': 'SILVER', 'needsScore': 3, 'needsJobs': 0},
      });
      // Same field, different meaning — a gap now rather than a target.
      expect(started.nextBand!.isAbsolute, isFalse);
    });
  });

  group('job status', () {
    test('cancelling stops once the technician has arrived', () {
      expect(BookingStatus.accepted.canProviderCancel, isTrue);
      expect(BookingStatus.enRoute.canProviderCancel, isTrue);
      expect(BookingStatus.arrived.canProviderCancel, isFalse);
      expect(BookingStatus.inProgress.canProviderCancel, isFalse);
    });

    test('every live state says what to do next', () {
      for (final status in [
        BookingStatus.requested,
        BookingStatus.accepted,
        BookingStatus.enRoute,
        BookingStatus.arrived,
        BookingStatus.inProgress,
      ]) {
        expect(status.nextAction, isNotEmpty, reason: '$status needs a prompt');
      }
    });
  });

  group('palette', () {
    test('text colours clear WCAG AA on the ground', () {
      double ratio(Color a, Color b) {
        final l1 = a.computeLuminance(), l2 = b.computeLuminance();
        final hi = l1 > l2 ? l1 : l2, lo = l1 > l2 ? l2 : l1;
        return (hi + 0.05) / (lo + 0.05);
      }

      expect(ratio(AppColors.ink, AppColors.ground), greaterThan(4.5));
      expect(ratio(AppColors.grey, AppColors.ground), greaterThan(4.5));
      expect(ratio(AppColors.graphite, AppColors.ground), greaterThan(4.5));
      expect(ratio(AppColors.amber, AppColors.ground), greaterThan(4.5));
    });

    test('the brand does not collide with any meaning colour', () {
      // The whole reason for graphite: green, amber and red each have to keep
      // meaning one thing, so the chrome must not be any of them.
      expect(AppColors.graphite, isNot(AppColors.green));
      expect(AppColors.graphite, isNot(AppColors.amber));
      expect(AppColors.graphite, isNot(AppColors.red));
    });
  });
}
