import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_error.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import 'app_button.dart';

/// A shimmering placeholder the shape of the thing that is loading.
///
/// Shaped like the result on purpose: a skeleton that matches stops the
/// layout jumping when data lands, which on a slow connection is the
/// difference between an app that feels considered and one that feels broken.
class Shimmer extends StatefulWidget {
  const Shimmer({
    super.key,
    this.width = double.infinity,
    this.height = 10,
    this.radius = 6,
  });

  final double width;
  final double height;
  final double radius;

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1350),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Respect the system setting: someone who has asked for less motion
    // should get a flat placeholder, not a pulsing one.
    final reduceMotion = MediaQuery.disableAnimationsOf(context);

    if (reduceMotion) {
      return _bar(const [AppColors.rule, AppColors.rule], 0);
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (_, __) => _bar(
        const [AppColors.rule, AppColors.mist, AppColors.rule],
        _controller.value,
      ),
    );
  }

  Widget _bar(List<Color> colors, double t) {
    return Container(
      width: widget.width,
      height: widget.height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(widget.radius),
        gradient: LinearGradient(
          colors: colors,
          begin: Alignment(-1 - 2 * (1 - t), 0),
          end: Alignment(1 - 2 * (1 - t) + 1, 0),
        ),
      ),
    );
  }
}

/// Nothing to show, and a way forward.
///
/// Never a bare "No results" — an empty state that does not say what to do
/// next is a dead end, and on a marketplace with five technicians in it,
/// empty is going to happen.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                color: AppColors.mist,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 28, color: AppColors.greyLight),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(title, style: AppType.heading, textAlign: TextAlign.center),
            const SizedBox(height: AppSpacing.sm),
            Text(
              message,
              style: AppType.body.copyWith(color: AppColors.grey),
              textAlign: TextAlign.center,
            ),
            if (actionLabel != null) ...[
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: actionLabel!,
                onPressed: onAction,
                expand: false,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Something failed, with the server's own words and a way to try again.
///
/// The API returns an already-localised `message` on every error, so the
/// default here is to show that rather than to invent copy. The exception is
/// a dead network, where the server said nothing and the app has to.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final api = error is ApiError ? error as ApiError : null;
    final isNetwork = api?.isNetwork ?? false;

    return EmptyState(
      icon: isNetwork ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
      title: isNetwork ? 'No connection' : 'Something went wrong',
      message: api?.message ??
          'Please try again in a moment.',
      actionLabel: onRetry == null ? null : 'Try again',
      onAction: onRetry,
    );
  }
}

/// The three states of any list, in one place, so no screen invents its own.
class AsyncListView<T> extends StatelessWidget {
  const AsyncListView({
    super.key,
    required this.value,
    required this.builder,
    required this.empty,
    this.loading,
    this.onRetry,
  });

  final AsyncValue<List<T>> value;
  final Widget Function(List<T> items) builder;
  final Widget empty;
  final Widget? loading;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => loading ?? const _DefaultLoading(),
      error: (e, _) => ErrorState(error: e, onRetry: onRetry),
      data: (items) => items.isEmpty ? empty : builder(items),
    );
  }
}

class _DefaultLoading extends StatelessWidget {
  const _DefaultLoading();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.screenX,
        vertical: AppSpacing.md,
      ),
      itemCount: 4,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
      itemBuilder: (_, __) => Container(
        padding: const EdgeInsets.all(AppSpacing.md + 1),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.cardR,
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            const Shimmer(width: 46, height: 46, radius: 14),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Shimmer(width: 150, height: 11),
                  SizedBox(height: AppSpacing.sm),
                  Shimmer(width: 100, height: 9),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
