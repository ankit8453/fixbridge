import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fixbridge/core/theme/app_colors.dart';
import 'package:fixbridge/data/models/money.dart';
import 'package:fixbridge/data/models/booking.dart';

/// A first pass, covering the rules that are expensive to get wrong.
///
/// Deliberately not a smoke test that pumps the whole app: the app's first
/// frame depends on stored preferences and a network call, so a widget test
/// over it would assert almost nothing while breaking constantly.
void main() {
  group('money', () {
    test('renders whole rupees without decimals', () {
      // ₹1,090.00 reads slower than ₹1,090 on a screen people scan.
      expect(Paise.format(109000), '₹1,090');
      expect(Paise.format(55000), '₹550');
      expect(Paise.format(0), '₹0');
      // Indian grouping, not thousands: ₹1,50,000 rather than ₹150,000.
      expect(Paise.format(15000000), '₹1,50,000');
    });

    test('keeps paise when an amount is not whole rupees', () {
      expect(Paise.format(55050), '₹550.50');
    });

    test("prefers the server's own display string", () {
      // The server formats in the caller's locale; re-deriving it here is how
      // the app and the receipt end up disagreeing about a bill.
      expect(Paise.show('₹1,090', 109000), '₹1,090');
      expect(Paise.show(null, 55000), '₹550');
      expect(Paise.show(null, null), '—');
    });

    test('refuses to guess at a malformed amount', () {
      // Silently reading a broken money field as 0 is the worst possible
      // parse failure, so it throws instead.
      expect(() => asPaise('not-a-number'), throwsFormatException);
      expect(asPaise(500), 500);
      expect(asPaise('500'), 500);
    });
  });

  group('booking status', () {
    test('nothing cancels once the technician has arrived', () {
      // Once somebody is at the door, "I changed my mind" is a dispute, not a
      // cancellation — so the button must disappear rather than fail.
      expect(BookingStatus.requested.canCustomerCancel, isTrue);
      expect(BookingStatus.accepted.canCustomerCancel, isTrue);
      expect(BookingStatus.enRoute.canCustomerCancel, isTrue);
      expect(BookingStatus.arrived.canCustomerCancel, isFalse);
      expect(BookingStatus.inProgress.canCustomerCancel, isFalse);
      expect(BookingStatus.workDone.canCustomerCancel, isFalse);
    });

    test('terminal states stop the poller', () {
      for (final status in [
        BookingStatus.rejected,
        BookingStatus.expired,
        BookingStatus.workDone,
        BookingStatus.cancelledByCustomer,
        BookingStatus.cancelledByProvider,
        BookingStatus.closedQuoteDeclined,
      ]) {
        expect(status.isTerminal, isTrue, reason: '$status should be terminal');
        expect(status.isLive, isFalse, reason: '$status should not poll');
      }
    });

    test('live states are exactly the ones worth polling', () {
      for (final status in [
        BookingStatus.requested,
        BookingStatus.accepted,
        BookingStatus.enRoute,
        BookingStatus.arrived,
        BookingStatus.inProgress,
      ]) {
        expect(status.isLive, isTrue, reason: '$status should poll');
        expect(status.isTerminal, isFalse);
      }
    });

    test('a complaint is possible only once somebody turned up', () {
      expect(BookingStatus.requested.canComplain, isFalse);
      expect(BookingStatus.enRoute.canComplain, isFalse);
      expect(BookingStatus.arrived.canComplain, isTrue);
      expect(BookingStatus.workDone.canComplain, isTrue);
    });

    test('an unknown status from the server does not crash', () {
      // A new state added server-side must degrade, not throw.
      final status = BookingStatus.parse('SOMETHING_NEW');
      expect(status, BookingStatus.unknown);
      expect(status.isLive, isFalse);
      expect(status.canCustomerCancel, isFalse);
    });

    test('only billable states settle a price', () {
      expect(BookingStatus.workDone.isBillable, isTrue);
      expect(BookingStatus.closedQuoteDeclined.isBillable, isTrue);
      expect(BookingStatus.cancelledByCustomer.isBillable, isFalse);
    });
  });

  group('palette', () {
    test('text colours clear WCAG AA against the ground', () {
      // These are read outdoors on cheap screens, so the contrast floor is
      // not decorative.
      double luminance(Color c) => c.computeLuminance();
      double ratio(Color a, Color b) {
        final l1 = luminance(a), l2 = luminance(b);
        final hi = l1 > l2 ? l1 : l2, lo = l1 > l2 ? l2 : l1;
        return (hi + 0.05) / (lo + 0.05);
      }

      expect(ratio(AppColors.ink, AppColors.ground), greaterThan(4.5));
      expect(ratio(AppColors.grey, AppColors.ground), greaterThan(4.5));
      expect(ratio(AppColors.blue, AppColors.ground), greaterThan(4.5));
    });
  });
}
