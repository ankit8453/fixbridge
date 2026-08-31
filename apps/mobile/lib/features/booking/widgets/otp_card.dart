import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// The handshake code.
///
/// This is the trust mechanism of the whole product, so it gets the largest
/// type on the screen and its own card. Two rules it exists to honour:
///
/// * **Only the customer ever sees it.** The API returns `null` for these
///   fields to the technician, always — the code reaches them by the customer
///   reading it out loud, in person, which is the point.
/// * **The end code appears only while work is in progress.** Showing it
///   earlier would let it be handed over before anything had been done, which
///   is exactly what the handshake prevents. Nothing about a booking is
///   cached for the same reason.
class OtpCard extends StatelessWidget {
  const OtpCard({
    super.key,
    required this.code,
    required this.kind,
    required this.technicianName,
  });

  final String code;
  final OtpKind kind;
  final String technicianName;

  @override
  Widget build(BuildContext context) {
    final digits = code.split('');

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.lg,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardR,
        border: Border.all(color: AppColors.rule),
        boxShadow: AppColors.cardShadow,
      ),
      child: Column(
        children: [
          Text(
            kind == OtpKind.start ? 'START CODE' : 'END CODE',
            style: AppType.label.copyWith(color: AppColors.grey),
          ),
          const SizedBox(height: AppSpacing.md + 1),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < digits.length; i++) ...[
                if (i > 0) const SizedBox(width: AppSpacing.sm + 2),
                _Digit(digit: digits[i], delayIndex: i),
              ],
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            kind == OtpKind.start
                ? 'Read this out when $technicianName arrives, so they can '
                    'start the work.'
                : 'Read this out once you are happy the work is finished.',
            style: AppType.caption.copyWith(color: AppColors.grey),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

enum OtpKind { start, end }

/// One digit tile, sliding up on a short stagger.
///
/// The motion is not decoration: it draws the eye to four numbers that must
/// be read aloud correctly the first time, often across a doorway.
class _Digit extends StatefulWidget {
  const _Digit({required this.digit, required this.delayIndex});

  final String digit;
  final int delayIndex;

  @override
  State<_Digit> createState() => _DigitState();
}

class _DigitState extends State<_Digit> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: AppMotion.base,
  );

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(
      Duration(milliseconds: 60 * widget.delayIndex),
      () {
        if (mounted) _controller.forward();
      },
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tile = GestureDetector(
      // Long-press to copy: reading a code out over a phone call happens, and
      // retyping it into a message is worse than copying it.
      onLongPress: () {
        Clipboard.setData(ClipboardData(text: widget.digit));
        HapticFeedback.lightImpact();
      },
      child: Container(
        width: 52,
        height: 64,
        decoration: BoxDecoration(
          color: AppColors.mist,
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: AppColors.rule),
        ),
        alignment: Alignment.center,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Text(widget.digit, style: AppType.otpDigit),
            Positioned(
              bottom: 9,
              child: Container(
                width: 22,
                height: 3,
                decoration: BoxDecoration(
                  color: AppColors.blue,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
          ],
        ),
      ),
    );

    if (MediaQuery.disableAnimationsOf(context)) return tile;

    return AnimatedBuilder(
      animation: _controller,
      builder: (_, child) => Opacity(
        opacity: _controller.value,
        child: Transform.translate(
          offset: Offset(0, 10 * (1 - _controller.value)),
          child: child,
        ),
      ),
      child: tile,
    );
  }
}
