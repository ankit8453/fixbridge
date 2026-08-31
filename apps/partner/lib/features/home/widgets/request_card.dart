import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/booking.dart';
import '../../../data/models/money.dart';
import '../../../shared/widgets/app_button.dart';

/// A job waiting for an answer.
///
/// The loudest thing in the app, and the only card with a green border,
/// because it is the one moment where doing nothing costs money: a request
/// expires an hour after it is made, and there is no push notification to
/// chase it with.
class RequestCard extends StatelessWidget {
  const RequestCard({
    super.key,
    required this.booking,
    required this.onAccept,
    required this.onDecline,
    this.busy = false,
  });

  final Booking booking;
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    // The API expires a request an hour after it was made.
    final expiresAt = booking.createdAt.add(const Duration(hours: 1));

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardR,
        border: Border.all(color: AppColors.green, width: 1.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x4012B76A),
            blurRadius: 26,
            offset: Offset(0, 10),
            spreadRadius: -12,
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned(
            left: 0,
            top: 0,
            bottom: 0,
            child: Container(width: 4, color: AppColors.green),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const _NewTag(),
                    const Spacer(),
                    _Countdown(expiresAt: expiresAt),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            AppColors.graphite,
                            AppColors.graphiteMid,
                          ],
                        ),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        _initials(booking.counterpart.displayName),
                        style: AppType.cardTitle.copyWith(
                          color: Colors.white,
                          fontSize: 15,
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            booking.counterpart.displayName,
                            style: AppType.cardTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            // The address is withheld until acceptance, so
                            // there is deliberately no street here — only the
                            // when, which is what the decision turns on.
                            _when(booking.startsAt),
                            style: AppType.meta.copyWith(color: AppColors.grey),
                          ),
                        ],
                      ),
                    ),
                    if (booking.agreedLabour.amountPaise != null)
                      Text(
                        Paise.format(booking.agreedLabour.amountPaise!),
                        style: AppType.amountLarge.copyWith(
                          fontSize: 19,
                          color: AppColors.green,
                        ),
                      ),
                  ],
                ),
                if (booking.problemNote != null &&
                    booking.problemNote!.trim().isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.mist,
                      borderRadius: AppRadius.tileR,
                    ),
                    child: Text(
                      '“${booking.problemNote!.trim()}”',
                      style: AppType.meta.copyWith(color: AppColors.inkMuted),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
                Row(
                  children: [
                    Expanded(
                      child: AppButton(
                        label: 'Decline',
                        kind: AppButtonKind.ghost,
                        onPressed: busy ? null : onDecline,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      flex: 2,
                      child: AppButton(
                        label: 'Accept job',
                        kind: AppButtonKind.accent,
                        loading: busy,
                        onPressed: onAccept,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }

  static String _when(DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(dt.year, dt.month, dt.day);
    final diff = day.difference(today).inDays;
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final period = dt.hour < 12 ? 'am' : 'pm';
    final time = dt.minute == 0
        ? '$h $period'
        : '$h:${dt.minute.toString().padLeft(2, '0')} $period';

    return switch (diff) {
      0 => 'Today, $time',
      1 => 'Tomorrow, $time',
      _ => '${dt.day}/${dt.month}, $time',
    };
  }
}

class _NewTag extends StatefulWidget {
  const _NewTag();

  @override
  State<_NewTag> createState() => _NewTagState();
}

class _NewTagState extends State<_NewTag> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const dot = SizedBox(
      width: 6,
      height: 6,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: AppColors.green,
          shape: BoxShape.circle,
        ),
      ),
    );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.greenSoft,
        borderRadius: AppRadius.chipR,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (MediaQuery.disableAnimationsOf(context))
            dot
          else
            FadeTransition(
              opacity: Tween<double>(begin: 1, end: 0.3).animate(
                CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
              ),
              child: dot,
            ),
          const SizedBox(width: 6),
          Text(
            'NEW',
            style: AppType.label.copyWith(
              color: AppColors.greenDeep,
              fontSize: 9.5,
            ),
          ),
        ],
      ),
    );
  }
}

/// Time left to answer.
///
/// Amber rather than red, because a running clock is a prompt, not a failure —
/// and red is reserved here for things that have actually gone wrong. It turns
/// red only in the last five minutes, when it genuinely is urgent.
class _Countdown extends StatefulWidget {
  const _Countdown({required this.expiresAt});

  final DateTime expiresAt;

  @override
  State<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<_Countdown> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => setState(() {}),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.expiresAt.difference(DateTime.now());

    if (left.isNegative) {
      return Text(
        'Expired',
        style: AppType.meta.copyWith(
          color: AppColors.red,
          fontWeight: FontWeight.w700,
        ),
      );
    }

    final urgent = left.inMinutes < 5;
    final mm = left.inMinutes.remainder(60).toString().padLeft(2, '0');
    final ss = left.inSeconds.remainder(60).toString().padLeft(2, '0');
    final label = left.inHours > 0 ? '${left.inHours}:$mm:$ss' : '$mm:$ss';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: urgent ? AppColors.redSoft : AppColors.amberSoft,
        borderRadius: AppRadius.chipR,
        border: Border.all(
          color: urgent ? AppColors.redLine : AppColors.amberLine,
        ),
      ),
      child: Text(
        '$label left',
        style: AppType.amount.copyWith(
          fontSize: 11.5,
          color: urgent ? AppColors.red : AppColors.amber,
        ),
      ),
    );
  }
}
