import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/booking.dart';
import '../../l10n/app_text.dart';

/// How each booking state is described to the customer.
///
/// The database's words and the customer's words are not the same words.
/// `CLOSED_QUOTE_DECLINED` is precise and meaningless to a person; "You
/// declined the price" is what actually happened to them. Every string that
/// reaches a customer about a booking comes from here, so the vocabulary
/// stays consistent across the home card, the list and the detail screen.
extension BookingStatusUi on BookingStatus {
  String get customerLabel => switch (this) {
        BookingStatus.requested => tr('bookings.waitingForAReply'),
        BookingStatus.accepted => tr('bookings.accepted'),
        BookingStatus.rejected => tr('bookings.declined'),
        BookingStatus.expired => tr('bookings.noReplyInTime'),
        BookingStatus.enRoute => tr('bookings.onTheWay'),
        BookingStatus.arrived => tr('bookings.atYourDoor'),
        BookingStatus.inProgress => tr('bookings.workInProgress'),
        BookingStatus.workDone => tr('bookings.workDone'),
        BookingStatus.cancelledByCustomer => tr('bookings.youCancelled'),
        BookingStatus.cancelledByProvider => tr('bookings.technicianCancelled'),
        BookingStatus.closedQuoteDeclined => tr('bookings.youDeclinedThePrice'),
        BookingStatus.unknown => tr('bookings.booking'),
      };

  /// A longer line for the detail screen, saying what happens next rather
  /// than only what has happened.
  String get customerDetail => switch (this) {
        BookingStatus.requested =>
          tr('bookings.weWillTellYouAs'),
        BookingStatus.accepted =>
          tr('bookings.yourStartCodeIsBelow'),
        BookingStatus.rejected =>
          tr('bookings.theyCouldNotTakeThis'),
        BookingStatus.expired =>
          tr('bookings.nobodyRepliedInTimeSo'),
        BookingStatus.enRoute => tr('bookings.haveYourStartCodeReady'),
        BookingStatus.arrived => tr('bookings.readOutYourStartCode'),
        BookingStatus.inProgress =>
          tr('bookings.whenTheWorkIsDone'),
        BookingStatus.workDone => tr('bookings.allDone'),
        BookingStatus.cancelledByCustomer => tr('bookings.youCancelledThisBooking'),
        BookingStatus.cancelledByProvider =>
          tr('bookings.theTechnicianCancelledNothingWas'),
        BookingStatus.closedQuoteDeclined =>
          tr('bookings.youDecidedNotToGo'),
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
  final time = tr('bookings.hourMinutePeriod', {'hour': hour, 'minute': minute, 'period': period});

  return switch (diff) {
    0 => tr('bookings.todayTime', {'time': time}),
    1 => tr('bookings.tomorrowTime', {'time': time}),
    -1 => tr('bookings.yesterdayTime', {'time': time}),
    _ => '${dt.day} ${_months[dt.month - 1]}, $time',
  };
}

List<String> get _months => [
  tr('bookings.jan'),
  tr('bookings.feb'),
  tr('bookings.mar'),
  tr('bookings.apr'),
  tr('bookings.may'),
  tr('bookings.jun'),
  tr('bookings.jul'),
  tr('bookings.aug'),
  tr('bookings.sep'),
  tr('bookings.oct'),
  tr('bookings.nov'),
  tr('bookings.dec'),
];
