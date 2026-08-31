import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/booking.dart';
import '../../data/models/money.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/avatar.dart';
import '../../shared/widgets/states.dart';
import '../auth/auth_controller.dart';
import '../home/home_providers.dart';
import 'booking_status_ui.dart';

class BookingsScreen extends ConsumerWidget {
  const BookingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final bookings = ref.watch(myBookingsProvider);

    return Scaffold(
      backgroundColor: AppColors.ground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screenX,
                AppSpacing.sm,
                AppSpacing.screenX,
                AppSpacing.md,
              ),
              child: Text('Your bookings', style: AppType.title),
            ),
            Expanded(
              child: !auth.isSignedIn
                  ? const EmptyState(
                      icon: Icons.receipt_long_outlined,
                      title: 'Nothing here yet',
                      message:
                          'Sign in to see the jobs you have booked. You can '
                          'browse technicians without an account.',
                    )
                  : bookings.when(
                      loading: () => const _BookingsSkeleton(),
                      error: (e, _) => ErrorState(
                        error: e,
                        onRetry: () => ref.invalidate(myBookingsProvider),
                      ),
                      data: (list) => list.isEmpty
                          ? const EmptyState(
                              icon: Icons.receipt_long_outlined,
                              title: 'No bookings yet',
                              message:
                                  'When you book a technician it will show up '
                                  'here, from the moment you ask until the '
                                  'work is done.',
                            )
                          : RefreshIndicator(
                              color: AppColors.blue,
                              onRefresh: () async {
                                ref.invalidate(myBookingsProvider);
                                await ref.read(myBookingsProvider.future);
                              },
                              child: ListView.separated(
                                padding: const EdgeInsets.fromLTRB(
                                  AppSpacing.screenX,
                                  0,
                                  AppSpacing.screenX,
                                  96,
                                ),
                                itemCount: list.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: AppSpacing.md),
                                itemBuilder: (_, i) => _BookingRow(
                                  booking: list[i],
                                  onTap: () =>
                                      context.push('/booking/${list[i].id}'),
                                ),
                              ),
                            ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BookingRow extends StatelessWidget {
  const _BookingRow({required this.booking, required this.onTap});

  final Booking booking;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = booking.status;

    return AppCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Avatar(
                name: booking.counterpart.displayName,
                photoUrl: booking.counterpart.photoUrl,
                size: 44,
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
                    const SizedBox(height: 3),
                    Text(
                      formatWhen(booking.startsAt),
                      style: AppType.meta.copyWith(color: AppColors.grey),
                    ),
                  ],
                ),
              ),
              // The settled amount, once there is one. Before that the
                // booking has no price to show and inventing one would be a
                // lie about a number the customer cares about.
              if (booking.payablePaise != null)
                Text(
                  Paise.show(
                    booking.payable?.payableDisplay,
                    booking.payablePaise,
                  ),
                  style: AppType.amount,
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm + 2,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: status.toneSoft,
                  borderRadius: AppRadius.chipR,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(status.icon, size: 12, color: status.tone),
                    const SizedBox(width: 5),
                    Text(
                      status.customerLabel,
                      style: AppType.meta.copyWith(
                        color: status.tone,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              if (booking.hasPendingQuote)
                Text(
                  'Price waiting',
                  style: AppType.meta.copyWith(
                    color: AppColors.amberText,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BookingsSkeleton extends StatelessWidget {
  const _BookingsSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenX,
        0,
        AppSpacing.screenX,
        96,
      ),
      itemCount: 3,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
      itemBuilder: (_, __) => AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Shimmer(width: 44, height: 44, radius: 14),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Shimmer(width: 130, height: 11),
                      SizedBox(height: AppSpacing.sm),
                      Shimmer(width: 90, height: 9),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            const Shimmer(width: 110, height: 20, radius: 999),
          ],
        ),
      ),
    );
  }
}
