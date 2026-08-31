import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../data/models/booking.dart';

/// The six-stage progress rail.
///
/// The fill animates as the booking advances, and that animation is honest:
/// it moves only when the server said the stage changed, never on a timer or
/// a guess. It is the one place in the app that shows progress the app did
/// not invent.
class ProgressRail extends StatelessWidget {
  const ProgressRail({super.key, required this.status});

  final BookingStatus status;

  static const _stages = [
    (label: 'Asked', short: 'Asked'),
    (label: 'Accepted', short: 'Accepted'),
    (label: 'On the way', short: 'En route'),
    (label: 'Arrived', short: 'Arrived'),
    (label: 'Working', short: 'Working'),
    (label: 'Done', short: 'Done'),
  ];

  @override
  Widget build(BuildContext context) {
    final index = status.stageIndex;

    // A cancelled or rejected booking never reached a stage worth drawing;
    // the detail screen shows a plain explanation instead of a fake rail.
    if (index < 0) return const SizedBox.shrink();

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final step = width / (_stages.length - 1);
        final fill = step * index;

        return Column(
          children: [
            SizedBox(
              height: 14,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    left: 0,
                    right: 0,
                    top: 5.5,
                    child: Container(
                      height: 3,
                      decoration: BoxDecoration(
                        color: AppColors.rule,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                  AnimatedPositioned(
                    duration: AppMotion.slow,
                    curve: AppMotion.enter,
                    left: 0,
                    top: 5.5,
                    width: fill,
                    child: Container(
                      height: 3,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [AppColors.blue, AppColors.sky],
                        ),
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                  for (var i = 0; i < _stages.length; i++)
                    Positioned(
                      left: (step * i - 6.5).clamp(0.0, width - 13),
                      top: 0,
                      child: _Bead(
                        done: i < index,
                        current: i == index,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                for (var i = 0; i < _stages.length; i++)
                  Expanded(
                    child: Text(
                      _stages[i].short,
                      textAlign: i == 0
                          ? TextAlign.start
                          : i == _stages.length - 1
                              ? TextAlign.end
                              : TextAlign.center,
                      style: AppType.caption.copyWith(
                        fontSize: 8.5,
                        fontWeight:
                            i == index ? FontWeight.w700 : FontWeight.w500,
                        color: i <= index
                            ? (i == index ? AppColors.blue : AppColors.inkMuted)
                            : AppColors.greyLight,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _Bead extends StatefulWidget {
  const _Bead({required this.done, required this.current});

  final bool done;
  final bool current;

  @override
  State<_Bead> createState() => _BeadState();
}

class _BeadState extends State<_Bead> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: AppMotion.pulse,
  );

  @override
  void initState() {
    super.initState();
    if (widget.current) _controller.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(_Bead old) {
    super.didUpdateWidget(old);
    if (widget.current && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.current && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filled = widget.done || widget.current;

    final bead = Container(
      width: 13,
      height: 13,
      decoration: BoxDecoration(
        color: widget.current
            ? AppColors.surface
            : widget.done
                ? AppColors.blue
                : AppColors.surface,
        shape: BoxShape.circle,
        border: Border.all(
          color: filled ? AppColors.blue : AppColors.rule,
          width: widget.current ? 2.5 : 2,
        ),
      ),
    );

    // The pulse marks the one stage that is happening right now. It stops the
    // moment the booking advances, so a still screen means a still job.
    if (!widget.current || MediaQuery.disableAnimationsOf(context)) {
      return bead;
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (_, child) => Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: AppColors.blue.withValues(
                alpha: 0.18 * (1 - _controller.value),
              ),
              blurRadius: 0,
              spreadRadius: 4 + (5 * _controller.value),
            ),
          ],
        ),
        child: child,
      ),
      child: bead,
    );
  }
}
