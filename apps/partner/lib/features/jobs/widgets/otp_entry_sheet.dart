import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/app_button.dart';

/// Typing in the code the customer reads out.
///
/// The technician never sees this code in their own app — the API returns
/// null for it on their side, always. It reaches them by the customer saying
/// it aloud, in person, which is the entire point: it proves somebody was
/// actually at the door.
///
/// Five wrong attempts lock the booking for seven days and only ops can
/// unlock it, so the remaining count is shown from the first mistake rather
/// than sprung at the end.
class OtpEntrySheet extends StatefulWidget {
  const OtpEntrySheet({
    super.key,
    required this.title,
    required this.blurb,
    required this.confirmLabel,
    this.error,
    this.attemptsLeft,
    this.busy = false,
  });

  final String title;
  final String blurb;
  final String confirmLabel;
  final String? error;
  final int? attemptsLeft;
  final bool busy;

  @override
  State<OtpEntrySheet> createState() => _OtpEntrySheetState();
}

class _OtpEntrySheetState extends State<OtpEntrySheet> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  /// The API accepts 4–8 digits; the configured length is 4.
  static const _length = 4;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _submit() {
    if (_controller.text.length < _length || widget.busy) return;
    Navigator.pop(context, _controller.text);
  }

  @override
  Widget build(BuildContext context) {
    final value = _controller.text;

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.xl,
        right: AppSpacing.xl,
        top: AppSpacing.sm,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.xl,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.title, style: AppType.heading),
            const SizedBox(height: AppSpacing.xs),
            Text(
              widget.blurb,
              style: AppType.body.copyWith(color: AppColors.grey),
            ),
            const SizedBox(height: AppSpacing.lg),
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.graphiteSoft,
                borderRadius: AppRadius.tileR,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.shield_outlined,
                    size: 16,
                    color: AppColors.graphite,
                  ),
                  const SizedBox(width: AppSpacing.sm + 2),
                  Expanded(
                    child: Text(
                      // Framed as protection for them, which is true: the code
                      // is the evidence that they turned up, if a customer
                      // ever disputes it.
                      'Do not start without it. The code proves you were at '
                      'the door — it protects you as much as the customer.',
                      style: AppType.meta.copyWith(color: AppColors.inkMuted),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            GestureDetector(
              onTap: () => _focus.requestFocus(),
              behavior: HitTestBehavior.opaque,
              child: Stack(
                children: [
                  // A real field underneath, invisible, so the platform
                  // keyboard, paste and backspace all behave normally.
                  SizedBox(
                    height: 64,
                    child: Opacity(
                      opacity: 0,
                      child: TextField(
                        controller: _controller,
                        focusNode: _focus,
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(_length),
                        ],
                        onChanged: (v) {
                          setState(() {});
                          if (v.length == _length) _submit();
                        },
                        showCursor: false,
                        enableInteractiveSelection: false,
                      ),
                    ),
                  ),
                  Positioned.fill(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(_length, (i) {
                        final filled = i < value.length;
                        final isNext = i == value.length && _focus.hasFocus;

                        return Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 5),
                          child: AnimatedContainer(
                            duration: AppMotion.quick,
                            width: 52,
                            height: 64,
                            decoration: BoxDecoration(
                              color:
                                  filled ? AppColors.surface : AppColors.mist,
                              borderRadius: BorderRadius.circular(15),
                              border: Border.all(
                                color: widget.error != null
                                    ? AppColors.red
                                    : isNext
                                        ? AppColors.graphite
                                        : AppColors.rule,
                                width: isNext || widget.error != null ? 1.5 : 1,
                              ),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              filled ? value[i] : '',
                              style: AppType.otpDigit,
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                ],
              ),
            ),
            if (widget.error != null) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                widget.error!,
                style: AppType.meta.copyWith(color: AppColors.red),
                textAlign: TextAlign.center,
              ),
            ],
            if (widget.attemptsLeft != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                widget.attemptsLeft == 1
                    ? 'One attempt left — after that only support can unlock it'
                    : '${widget.attemptsLeft} attempts left',
                style: AppType.caption.copyWith(
                  color: widget.attemptsLeft! <= 2
                      ? AppColors.red
                      : AppColors.grey,
                  fontWeight: FontWeight.w600,
                ),
                textAlign: TextAlign.center,
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: widget.confirmLabel,
              kind: AppButtonKind.accent,
              loading: widget.busy,
              onPressed: value.length == _length ? _submit : null,
            ),
          ],
        ),
      ),
    );
  }
}
