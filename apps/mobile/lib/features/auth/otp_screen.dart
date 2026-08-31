import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../shared/widgets/app_button.dart';
import 'auth_controller.dart';

class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key, this.redirectTo});

  final String? redirectTo;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  String? _error;
  bool _verifying = false;
  int _resendIn = 60;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startResendTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _startResendTimer() {
    _timer?.cancel();
    setState(() => _resendIn = 60);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn -= 1);
      if (_resendIn <= 0) t.cancel();
    });
  }

  Future<void> _verify() async {
    if (_controller.text.length != 6 || _verifying) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _verifying = true;
      _error = null;
    });

    try {
      await ref
          .read(authControllerProvider.notifier)
          .verifyOtp(_controller.text);
      if (!mounted) return;
      context.go(widget.redirectTo ?? '/');
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        // A wrong code and an expired one are the same OTP_INVALID by
        // design, so no attempt is made to tell them apart here.
        _error = e.isRateLimited
            ? 'Too many attempts. Ask for a new code.'
            : e.message;
        _controller.clear();
      });
      _focus.requestFocus();
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  Future<void> _resend() async {
    final phone = ref.read(authControllerProvider.notifier).pendingPhone;
    if (phone == null) return context.pop();

    setState(() => _error = null);
    try {
      await ref.read(authControllerProvider.notifier).requestOtp(phone);
      _startResendTimer();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('A new code is on its way.')),
        );
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final masked = ref.read(authControllerProvider.notifier).maskedPhone ?? '';

    return Scaffold(
      backgroundColor: AppColors.ground,
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.only(left: AppSpacing.md),
          child: AppIconButton(
            icon: Icons.arrow_back_rounded,
            onPressed: () => context.pop(),
          ),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppSpacing.lg),
              Text('Enter the code', style: AppType.title),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Sent to $masked',
                style: AppType.body.copyWith(color: AppColors.grey),
              ),
              const SizedBox(height: AppSpacing.xxl),
              OtpInput(
                controller: _controller,
                focusNode: _focus,
                hasError: _error != null,
                onChanged: (value) {
                  if (_error != null) setState(() => _error = null);
                  if (value.length == 6) _verify();
                },
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(
                  _error!,
                  style: AppType.meta.copyWith(color: AppColors.red),
                  textAlign: TextAlign.center,
                ),
              ],
              const SizedBox(height: AppSpacing.xl),
              Center(
                child: _resendIn > 0
                    ? Text(
                        'Resend in ${_resendIn}s',
                        style:
                            AppType.meta.copyWith(color: AppColors.greyLight),
                      )
                    : TextButton(
                        onPressed: _resend,
                        child: Text(
                          'Send a new code',
                          style: AppType.bodyMedium.copyWith(
                            color: AppColors.blue,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
              ),
              const Spacer(),
              AppButton(
                label: 'Verify',
                loading: _verifying,
                onPressed: _controller.text.length == 6 ? _verify : null,
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}

/// Six boxes over one real text field.
///
/// The boxes are painted from the field's value rather than being six separate
/// inputs. That matters: a grid of individual fields breaks paste, breaks the
/// SMS autofill the platform offers, and breaks backspace across boundaries —
/// and a keypad that only accepts taps and refuses the keyboard is a bug
/// people hit immediately.
class OtpInput extends StatefulWidget {
  const OtpInput({
    super.key,
    required this.controller,
    required this.focusNode,
    this.length = 6,
    this.hasError = false,
    this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final int length;
  final bool hasError;
  final ValueChanged<String>? onChanged;

  @override
  State<OtpInput> createState() => _OtpInputState();
}

class _OtpInputState extends State<OtpInput> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChange);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    setState(() {});
    widget.onChanged?.call(widget.controller.text);
  }

  @override
  Widget build(BuildContext context) {
    final value = widget.controller.text;

    return GestureDetector(
      onTap: () => widget.focusNode.requestFocus(),
      behavior: HitTestBehavior.opaque,
      child: Stack(
        children: [
          // The real field, invisible but present, so the platform keyboard,
          // paste and SMS autofill all behave normally.
          SizedBox(
            height: 62,
            child: Opacity(
              opacity: 0,
              child: TextField(
                controller: widget.controller,
                focusNode: widget.focusNode,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(widget.length),
                ],
                showCursor: false,
                enableInteractiveSelection: false,
              ),
            ),
          ),
          Positioned.fill(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: List.generate(widget.length, (i) {
                final filled = i < value.length;
                final isNext = i == value.length && widget.focusNode.hasFocus;

                return AnimatedContainer(
                  duration: AppMotion.quick,
                  width: 46,
                  height: 62,
                  decoration: BoxDecoration(
                    color: filled ? AppColors.surface : AppColors.mist,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: widget.hasError
                          ? AppColors.red
                          : isNext
                              ? AppColors.blue
                              : AppColors.rule,
                      width: isNext || widget.hasError ? 1.5 : 1,
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    filled ? value[i] : '',
                    style: AppType.otpDigit.copyWith(fontSize: 24),
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }
}
