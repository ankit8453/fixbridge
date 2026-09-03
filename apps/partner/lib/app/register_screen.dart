import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_error.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_spacing.dart';
import '../core/theme/app_typography.dart';
import '../features/auth/auth_controller.dart';
import '../shared/widgets/app_button.dart';
import '../shared/widgets/app_field.dart';

/// Becoming a technician.
///
/// Shown to anybody signed in who does not yet hold the role — including a
/// customer who downloaded this app by mistake, which is why it explains what
/// the app is rather than assuming.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _name = TextEditingController();
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    if (_name.text.trim().isEmpty || _saving) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref
          .read(authControllerProvider.notifier)
          .registerAsTechnician(displayName: _name.text.trim());
      // The router moves on its own once the role lands in the session.
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 48),
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    gradient: AppColors.earningsGradient,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  alignment: Alignment.center,
                  child: const Icon(
                    Icons.handyman_rounded,
                    color: Colors.white,
                    size: 28,
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text('Start taking work', style: AppType.title),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'This is the app for technicians. Customers book you here, '
                  'you agree the price, and we pay out what you have earned.',
                  style: AppType.body.copyWith(color: AppColors.grey),
                ),
                const SizedBox(height: AppSpacing.xxl),
                AppField(
                  controller: _name,
                  label: 'What should customers see?',
                  hint: 'Your name',
                  error: _error,
                  autofocus: true,
                  maxLength: 120,
                  textCapitalization: TextCapitalization.words,
                  // Always rebuilds, not only to clear an error. The button
                  // below is enabled from this field's contents, so a keystroke
                  // that does not repaint leaves it disabled no matter how much
                  // is typed — which is a dead end on a screen with one button.
                  onChanged: (_) => setState(() => _error = null),
                  onSubmitted: (_) => _register(),
                ),
                const SizedBox(height: AppSpacing.xl),
                AppButton(
                  label: 'Continue',
                  loading: _saving,
                  onPressed: _name.text.trim().isEmpty ? null : _register,
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'Next you will add what you do, your prices, and when you '
                  'work — then get verified.',
                  style: AppType.caption.copyWith(color: AppColors.grey),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
