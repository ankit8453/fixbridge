import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_error.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_field.dart';
import 'auth_controller.dart';

/// Asked once, on the first sign-in, and never again.
///
/// Skippable on purpose. A technician arriving at a door does not need a
/// surname to do the job, and a required field between somebody and the thing
/// they came to do is a good way to lose them at the last step.
class NameScreen extends ConsumerStatefulWidget {
  const NameScreen({super.key, this.redirectTo});

  final String? redirectTo;

  @override
  ConsumerState<NameScreen> createState() => _NameScreenState();
}

class _NameScreenState extends ConsumerState<NameScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _done() {
    ref.read(authControllerProvider.notifier).nameHandled();
    context.go(widget.redirectTo ?? '/');
  }

  Future<void> _save() async {
    final name = _controller.text.trim();
    if (name.isEmpty) return _done();

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(authControllerProvider.notifier).setName(name);
      if (mounted) _done();
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.fieldMessage('displayName') ?? e.message);
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 56),
              Text('What should we call you?', style: AppType.title),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'The technician sees this when they accept your booking.',
                style: AppType.body.copyWith(color: AppColors.grey),
              ),
              const SizedBox(height: AppSpacing.xxl),
              AppField(
                controller: _controller,
                hint: 'Your name',
                error: _error,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                maxLength: 120,
                onChanged: (_) {
                  if (_error != null) setState(() => _error = null);
                },
                onSubmitted: (_) => _save(),
              ),
              const Spacer(),
              AppButton(
                label: 'Continue',
                loading: _saving,
                onPressed: _save,
              ),
              const SizedBox(height: AppSpacing.sm),
              AppButton(
                label: 'Skip for now',
                kind: AppButtonKind.quiet,
                onPressed: _saving ? null : _done,
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}
