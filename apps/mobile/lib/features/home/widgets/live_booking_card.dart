import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/booking.dart';

/// The live booking.
///
/// This is the **only** gradient in the app, and it is here because this is
/// the only thing on the screen that is genuinely in motion: a person is on
/// their way to somebody's house right now. Spending the app's one loud
/// element anywhere else would make this one stop meaning anything.
class LiveBookingCard extends StatelessWidget {
  const LiveBookingCard({
    super.key,
    required this.booking,
    required this.onTap,
  });

  final Booking booking;
  final VoidCallback onTap;

  /// Customer-facing status copy.
  ///
  /// Deliberately plain and in the second person. "REQUESTED" is a database
  /// state; "Waiting for a reply" is what is actually happening to you.
  String get _headline => switch (booking.status) {
        BookingStatus.requested => 'Waiting for a reply',
        BookingStatus.accepted =>
          '${booking.counterpart.displayName} accepted',
        BookingStatus.enRoute =>
          '${booking.counterpart.displayName} is on the way',
        BookingStatus.arrived =>
          '${booking.counterpart.displayName} has arrived',
        BookingStatus.inProgress => 'Work in progress',
        _ => 'Your booking',
      };

  String get _sub => switch (booking.status) {
        BookingStatus.requested =>
          'We will tell you as soon as they answer',
        BookingStatus.accepted => 'Arriving ${_time(booking.startsAt)}',
        BookingStatus.enRoute => 'Have your start code ready',
        BookingStatus.arrived => 'Read out your start code to begin',
        BookingStatus.inProgress => 'The price will come through when done',
        _ => '',
      };

  static String _time(DateTime dt) {
    final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final minute = dt.minute.toString().padLeft(2, '0');
    final period = dt.hour < 12 ? 'am' : 'pm';
    return '$hour:$minute $period';
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.cardR,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: const BoxDecoration(
            gradient: AppColors.liveGradient,
            borderRadius: AppRadius.cardR,
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              // A soft bloom in the corner, so the gradient reads as lit
              // rather than as a flat two-colour fill.
              Positioned(
                top: -80,
                right: -50,
                child: Container(
                  width: 190,
                  height: 190,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        Colors.white.withValues(alpha: 0.32),
                        Colors.white.withValues(alpha: 0),
                      ],
                      stops: const [0, 0.66],
                    ),
                  ),
                ),
              ),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const _LivePulse(),
                            const SizedBox(width: 7),
                            Text(
                              'LIVE BOOKING',
                              style: AppType.label.copyWith(
                                color: Colors.white.withValues(alpha: 0.92),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          _headline,
                          style: AppType.heading.copyWith(
                            color: Colors.white,
                            fontSize: 17,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (_sub.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            _sub,
                            style: AppType.meta.copyWith(
                              color: Colors.white.withValues(alpha: 0.9),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Container(
                    width: 34,
                    height: 34,
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.arrow_forward_rounded,
                      size: 17,
                      color: AppColors.blue,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The one looping animation in the app.
///
/// It earns the exception because it means something specific: this booking
/// is live *now*, and the screen is polling. When the booking reaches a
/// terminal state the card disappears and so does the pulse.
class _LivePulse extends StatefulWidget {
  const _LivePulse();

  @override
  State<_LivePulse> createState() => _LivePulseState();
}

class _LivePulseState extends State<_LivePulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: AppMotion.pulse,
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const dot = SizedBox(
      width: 7,
      height: 7,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Color(0xFF7DF0C0),
          shape: BoxShape.circle,
        ),
      ),
    );

    if (MediaQuery.disableAnimationsOf(context)) return dot;

    return FadeTransition(
      opacity: Tween<double>(begin: 1, end: 0.35).animate(
        CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
      ),
      child: dot,
    );
  }
}
