import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../data/models/booking.dart';
import '../../data/models/money.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/states.dart';
import '../home/partner_providers.dart';
import 'widgets/job_row.dart';

/// Every job, open and finished.
///
/// Two sections rather than a filter, because a technician has exactly two
/// questions here: what still needs doing, and what have I earned. Splitting
/// them client-side is necessary anyway — the API takes no status filter,
/// date range or pagination on this endpoint.
class JobsScreen extends ConsumerWidget {
  const JobsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jobs = ref.watch(jobsProvider);
    final active = ref.watch(activeJobsProvider);
    final finished = ref.watch(finishedJobsProvider);

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
              child: Text('Your jobs', style: AppType.title),
            ),
            Expanded(
              child: jobs.when(
                loading: () => ListView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.screenX,
                  ),
                  children: const [
                    Shimmer(height: 96, radius: 20),
                    SizedBox(height: AppSpacing.md),
                    Shimmer(height: 96, radius: 20),
                  ],
                ),
                error: (e, _) => ErrorState(
                  error: e,
                  onRetry: () => ref.read(jobsProvider.notifier).refresh(),
                ),
                data: (all) => all.isEmpty
                    ? const EmptyState(
                        icon: Icons.work_outline_rounded,
                        title: 'No jobs yet',
                        message:
                            'Everything you take on will be listed here, from '
                            'the request until it is paid.',
                      )
                    : RefreshIndicator(
                        color: AppColors.graphite,
                        onRefresh: () =>
                            ref.read(jobsProvider.notifier).refresh(),
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(
                            AppSpacing.screenX,
                            0,
                            AppSpacing.screenX,
                            96,
                          ),
                          children: [
                            if (active.isNotEmpty) ...[
                              const SectionHeader(title: 'Still open'),
                              for (final job in active)
                                Padding(
                                  padding: const EdgeInsets.only(
                                    bottom: AppSpacing.md,
                                  ),
                                  child: JobRow(
                                    booking: job,
                                    onTap: () => context.push('/job/${job.id}'),
                                  ),
                                ),
                            ],
                            if (finished.isNotEmpty) ...[
                              SectionHeader(
                                title: 'Finished',
                                actionLabel: _earnedLabel(finished),
                              ),
                              for (final job in finished)
                                Padding(
                                  padding: const EdgeInsets.only(
                                    bottom: AppSpacing.md,
                                  ),
                                  child: JobRow(
                                    booking: job,
                                    onTap: () => context.push('/job/${job.id}'),
                                  ),
                                ),
                            ],
                          ],
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Lifetime earnings, summed here because the API has no stats endpoint
  /// that answers it.
  static String _earnedLabel(List<Booking> finished) {
    var total = 0;
    for (final job in finished) {
      if (job.status == BookingStatus.workDone) {
        total += job.payablePaise ?? 0;
      }
    }
    return total == 0 ? '' : '${Paise.format(total)} earned';
  }
}
