import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/booking.dart';

/// How each state reads to the technician.
///
/// Different words from the customer app for the same states, because the two
/// sides are doing different things. "Waiting for a reply" is the customer's
/// experience of REQUESTED; "Needs your answer" is the technician's, and it
/// says what to do rather than what is happening.
extension JobStatusUi on BookingStatus {
  String get partnerLabel => switch (this) {
        BookingStatus.requested => 'Needs your answer',
        BookingStatus.accepted => 'Accepted',
        BookingStatus.rejected => 'You declined',
        BookingStatus.expired => 'Expired',
        BookingStatus.enRoute => 'On your way',
        BookingStatus.arrived => 'At the door',
        BookingStatus.inProgress => 'Working',
        BookingStatus.workDone => 'Finished',
        BookingStatus.cancelledByCustomer => 'Customer cancelled',
        BookingStatus.cancelledByProvider => 'You cancelled',
        BookingStatus.closedQuoteDeclined => 'Customer declined the price',
        BookingStatus.unknown => 'Job',
      };

  /// The single next thing to do. Empty when it is somebody else's move.
  String get nextAction => switch (this) {
        BookingStatus.requested => 'Accept or decline',
        BookingStatus.accepted => 'Set off when you are ready',
        BookingStatus.enRoute => 'Ask for the start code when you arrive',
        BookingStatus.arrived => 'Ask for the start code',
        BookingStatus.inProgress => 'Send the price, then finish',
        _ => '',
      };

  /// Green for anything live and going well, red only for the two endings
  /// where somebody was actually let down.
  Color get tone => switch (this) {
        BookingStatus.requested => AppColors.green,
        BookingStatus.accepted ||
        BookingStatus.enRoute ||
        BookingStatus.arrived ||
        BookingStatus.inProgress =>
          AppColors.graphite,
        BookingStatus.workDone => AppColors.green,
        BookingStatus.cancelledByCustomer ||
        BookingStatus.closedQuoteDeclined =>
          AppColors.red,
        _ => AppColors.grey,
      };

  Color get toneSoft => switch (this) {
        BookingStatus.requested => AppColors.greenSoft,
        BookingStatus.accepted ||
        BookingStatus.enRoute ||
        BookingStatus.arrived ||
        BookingStatus.inProgress =>
          AppColors.graphiteSoft,
        BookingStatus.workDone => AppColors.greenSoft,
        BookingStatus.cancelledByCustomer ||
        BookingStatus.closedQuoteDeclined =>
          AppColors.redSoft,
        _ => AppColors.mist,
      };

  IconData get icon => switch (this) {
        BookingStatus.requested => Icons.notifications_active_rounded,
        BookingStatus.accepted => Icons.event_available_rounded,
        BookingStatus.enRoute => Icons.directions_walk_rounded,
        BookingStatus.arrived => Icons.doorbell_outlined,
        BookingStatus.inProgress => Icons.handyman_rounded,
        BookingStatus.workDone => Icons.task_alt_rounded,
        BookingStatus.expired => Icons.timer_off_outlined,
        _ => Icons.cancel_outlined,
      };

  /// Only up to EN_ROUTE. After arrival it is a dispute, not a cancellation.
  bool get canProviderCancel =>
      this == BookingStatus.accepted || this == BookingStatus.enRoute;
}

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
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
