import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/booking.dart';

/// How each booking state is described to the customer.
///
/// The database's words and the customer's words are not the same words.
/// `CLOSED_QUOTE_DECLINED` is precise and meaningless to a person; "You
/// declined the price" is what actually happened to them. Every string that
/// reaches a customer about a booking comes from here, so the vocabulary
/// stays consistent across the home card, the list and the detail screen.
extension BookingStatusUi on BookingStatus {
  String get customerLabel => switch (this) {
        BookingStatus.requested => 'Waiting for a reply',
        BookingStatus.accepted => 'Accepted',
        BookingStatus.rejected => 'Declined',
        BookingStatus.expired => 'No reply in time',
        BookingStatus.enRoute => 'On the way',
        BookingStatus.arrived => 'At your door',
        BookingStatus.inProgress => 'Work in progress',
        BookingStatus.workDone => 'Work done',
        BookingStatus.cancelledByCustomer => 'You cancelled',
        BookingStatus.cancelledByProvider => 'Technician cancelled',
        BookingStatus.closedQuoteDeclined => 'You declined the price',
        BookingStatus.unknown => 'Booking',
      };

  /// A longer line for the detail screen, saying what happens next rather
  /// than only what has happened.
  String get customerDetail => switch (this) {
        BookingStatus.requested =>
          'We will tell you as soon as they answer. If nobody replies within '
              'an hour the booking closes on its own.',
        BookingStatus.accepted =>
          'Your start code is below. Read it out when they arrive.',
        BookingStatus.rejected =>
          'They could not take this job. You can book someone else.',
        BookingStatus.expired =>
          'Nobody replied in time, so nothing was charged.',
        BookingStatus.enRoute => 'Have your start code ready.',
        BookingStatus.arrived =>
          'Read out your start code so they can begin.',
        BookingStatus.inProgress =>
          'When the work is done you will see the price to approve.',
        BookingStatus.workDone => 'All done.',
        BookingStatus.cancelledByCustomer => 'You cancelled this booking.',
        BookingStatus.cancelledByProvider =>
          'The technician cancelled. Nothing was charged.',
        BookingStatus.closedQuoteDeclined =>
          'You decided not to go ahead at that price. The visit fee still '
              'applies, because they did come out to you.',
        BookingStatus.unknown => '',
      };

  /// Colour is meaning here, not decoration: blue for live, green for
  /// finished well, grey for finished without incident. Red is reserved for
  /// the two states where somebody was actually let down.
  Color get tone => switch (this) {
        BookingStatus.requested ||
        BookingStatus.accepted ||
        BookingStatus.enRoute ||
        BookingStatus.arrived ||
        BookingStatus.inProgress =>
          AppColors.blue,
        BookingStatus.workDone => AppColors.green,
        BookingStatus.rejected ||
        BookingStatus.cancelledByProvider =>
          AppColors.red,
        _ => AppColors.grey,
      };

  Color get toneSoft => switch (this) {
        BookingStatus.requested ||
        BookingStatus.accepted ||
        BookingStatus.enRoute ||
        BookingStatus.arrived ||
        BookingStatus.inProgress =>
          AppColors.blueSoft,
        BookingStatus.workDone => AppColors.greenSoft,
        BookingStatus.rejected ||
        BookingStatus.cancelledByProvider =>
          AppColors.redSoft,
        _ => AppColors.mist,
      };

  IconData get icon => switch (this) {
        BookingStatus.requested => Icons.hourglass_top_rounded,
        BookingStatus.accepted => Icons.check_circle_outline_rounded,
        BookingStatus.enRoute => Icons.directions_walk_rounded,
        BookingStatus.arrived => Icons.doorbell_outlined,
        BookingStatus.inProgress => Icons.handyman_rounded,
        BookingStatus.workDone => Icons.task_alt_rounded,
        BookingStatus.rejected ||
        BookingStatus.cancelledByCustomer ||
        BookingStatus.cancelledByProvider =>
          Icons.cancel_outlined,
        BookingStatus.expired => Icons.timer_off_outlined,
        BookingStatus.closedQuoteDeclined => Icons.do_not_disturb_on_outlined,
        BookingStatus.unknown => Icons.help_outline_rounded,
      };
}

/// A short human date: "Today, 2:30 pm".
String formatWhen(DateTime dt) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(dt.year, dt.month, dt.day);
  final diff = day.difference(today).inDays;

  final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour < 12 ? 'am' : 'pm';
  final time = '$hour:$minute $period';

  return switch (diff) {
    0 => 'Today, $time',
    1 => 'Tomorrow, $time',
    -1 => 'Yesterday, $time',
    _ => '${dt.day} ${_months[dt.month - 1]}, $time',
  };
}

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
