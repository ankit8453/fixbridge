import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/booking.dart';
import '../../l10n/app_text.dart';

/// How each state reads to the technician.
///
/// Different words from the customer app for the same states, because the two
/// sides are doing different things. "Waiting for a reply" is the customer's
/// experience of REQUESTED; "Needs your answer" is the technician's, and it
/// says what to do rather than what is happening.
extension JobStatusUi on BookingStatus {
  String get partnerLabel => switch (this) {
        BookingStatus.requested => tr('jobs.needsYourAnswer'),
        BookingStatus.accepted => tr('jobs.accepted'),
        BookingStatus.rejected => tr('jobs.youDeclined'),
        BookingStatus.expired => tr('jobs.expired'),
        BookingStatus.enRoute => tr('jobs.onYourWay'),
        BookingStatus.arrived => tr('jobs.atTheDoor'),
        BookingStatus.inProgress => tr('jobs.working'),
        BookingStatus.workDone => tr('jobs.finished'),
        BookingStatus.cancelledByCustomer => tr('jobs.customerCancelled'),
        BookingStatus.cancelledByProvider => tr('jobs.youCancelled'),
        BookingStatus.closedQuoteDeclined => tr('jobs.customerDeclinedThePrice'),
        BookingStatus.unknown => tr('jobs.job2'),
      };

  /// The single next thing to do. Empty when it is somebody else's move.
  String get nextAction => switch (this) {
        BookingStatus.requested => tr('jobs.acceptOrDecline'),
        BookingStatus.accepted => tr('jobs.setOffWhenYouAre'),
        BookingStatus.enRoute => tr('jobs.askForTheStartCode2'),
        BookingStatus.arrived => tr('jobs.askForTheStartCode3'),
        BookingStatus.inProgress => tr('jobs.sendThePriceThenFinish'),
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
  final time = tr('jobs.hourMinutePeriod', {'hour': hour, 'minute': minute, 'period': period});

  return switch (diff) {
    0 => tr('jobs.todayTime', {'time': time}),
    1 => tr('jobs.tomorrowTime', {'time': time}),
    -1 => tr('jobs.yesterdayTime', {'time': time}),
    _ => '${dt.day} ${_months[dt.month - 1]}, $time',
  };
}

List<String> get _months => [
  tr('jobs.jan'),
  tr('jobs.feb'),
  tr('jobs.mar'),
  tr('jobs.apr'),
  tr('jobs.may'),
  tr('jobs.jun'),
  tr('jobs.jul'),
  tr('jobs.aug'),
  tr('jobs.sep'),
  tr('jobs.oct'),
  tr('jobs.nov'),
  tr('jobs.dec'),
];
