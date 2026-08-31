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
import '../../shared/widgets/app_field.dart';
import 'auth_controller.dart';

/// Asks for a phone number, and only here.
///
/// The whole browse path is public, so somebody reaches this screen having
/// already found a technician they want. That is deliberate: asking for a
/// number before showing anything of value is the fastest way to lose them.
class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key, this.redirectTo});

  /// Where to go once signed in — set when sign-in was triggered by trying to
  /// book, so the person lands back on the thing they were doing.
  final String? redirectTo;

  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _sending = false;

  bool get _valid {
    final digits = _controller.text.replaceAll(RegExp(r'\D'), '');
    // Indian mobile numbers are ten digits starting 6–9. Checking here saves
    // a round trip and a rate-limit slot on an obvious typo.
    return digits.length == 10 && RegExp(r'^[6-9]').hasMatch(digits);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_valid || _sending) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _sending = true;
      _error = null;
    });

    final digits = _controller.text.replaceAll(RegExp(r'\D'), '');

    try {
      await ref.read(authControllerProvider.notifier).requestOtp('+91$digits');
      if (!mounted) return;
      final query = widget.redirectTo == null
          ? ''
          : '?redirect=${Uri.encodeComponent(widget.redirectTo!)}';
      // push() completes only when the OTP screen pops; nothing here waits
      // on that, so it is marked rather than awaited.
      unawaited(context.push('/signin/otp$query'));
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = _messageFor(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Three different limits sit behind one 429, and they mean different
  /// things to the person holding the phone. A generic "too many requests"
  /// would leave someone who simply tapped twice thinking they are blocked.
  String _messageFor(ApiError e) {
    if (!e.isRateLimited) return e.message;

    final seconds = e.retryAfterSeconds ?? 60;
    return switch (e.rateLimitScope) {
      'cooldown' => 'Wait $seconds seconds before asking for another code.',
      'phone' => 'Too many codes sent to this number. Try again later.',
      'ip' => 'Too many attempts from this connection. Try again later.',
      _ => e.message,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ground,
      appBar: AppBar(
        leading: context.canPop()
            ? Padding(
                padding: const EdgeInsets.only(left: AppSpacing.md),
                child: AppIconButton(
                  icon: Icons.arrow_back_rounded,
                  onPressed: () => context.pop(),
                ),
              )
            : null,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppSpacing.lg),
              Text('What is your number?', style: AppType.title),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'We will send a 6-digit code to confirm it.',
                style: AppType.body.copyWith(color: AppColors.grey),
              ),
              const SizedBox(height: AppSpacing.xxl),
              AppField(
                controller: _controller,
                hint: '98765 43210',
                error: _error,
                autofocus: true,
                keyboardType: TextInputType.phone,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(10),
                ],
                onChanged: (_) => setState(() => _error = null),
                onSubmitted: (_) => _send(),
                prefix: Padding(
                  padding: const EdgeInsets.only(
                    left: AppSpacing.lg,
                    right: AppSpacing.sm,
                  ),
                  child: Text(
                    '+91',
                    style: AppType.body.copyWith(
                      color: AppColors.ink,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const Spacer(),
              AppButton(
                label: 'Send code',
                loading: _sending,
                onPressed: _valid ? _send : null,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Your number is never shown to a technician until you book, '
                'and never shared with anyone else.',
                style: AppType.caption.copyWith(color: AppColors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}
